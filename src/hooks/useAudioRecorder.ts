import { useRef, useCallback } from 'react';
import { AUDIO_CONFIG } from '../constants';
import { calculateRMS, floatTo16BitPCM, arrayBufferToBase64 } from '../utils/audio';
import { electronService } from '../services/electron';

const LIVE_TRANSCRIPTION_CHUNK_MS = 40;
const SPEECH_PRE_ROLL_MS = 240;
const SILENCE_HANGOVER_MS = 500;
const MIN_ACTIVITY_THRESHOLD = 0.006;
const MAX_ACTIVITY_THRESHOLD = 0.03;
const NOISE_FLOOR_MULTIPLIER = 3;
const ACTIVITY_LOG_INTERVAL_MS = 5000;
const SEND_LOG_INTERVAL_MS = 10000;

interface AudioRecorderOptions {
  sampleRate?: number;
  bufferSize?: number;
  onChunk?: (base64: string, seq: number) => void;
  onRawChunk?: (samples: Float32Array) => void;
  onAudioStreamEnd?: () => void;
  onVolumeChange?: (volume: number) => void;
  isSystemAudio?: boolean;
}

/**
 * Low-level hook for managing AudioContext, Worklets, and MediaStreams.
 * Handles both Microphone and System Audio recording.
 */
export const useAudioRecorder = () => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<AudioWorkletNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sinkNodeRef = useRef<GainNode | null>(null);
  const chunkSeqRef = useRef<number>(0);
  const isRecordingActiveRef = useRef<boolean>(false);
  const flushLiveAudioRef = useRef<(() => void) | null>(null);

  const stopRecording = useCallback(() => {
    isRecordingActiveRef.current = false;
    if (flushLiveAudioRef.current) flushLiveAudioRef.current();
    flushLiveAudioRef.current = null;

    if (processorRef.current) processorRef.current.disconnect();
    if (gainNodeRef.current) gainNodeRef.current.disconnect();
    if (sinkNodeRef.current) sinkNodeRef.current.disconnect();
    if (audioContextRef.current) audioContextRef.current.close();
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    
    processorRef.current = null;
    gainNodeRef.current = null;
    sinkNodeRef.current = null;
    audioContextRef.current = null;
    streamRef.current = null;
    chunkSeqRef.current = 0;
  }, []);

  const startRecording = useCallback(async (options: AudioRecorderOptions) => {
    const { 
      sampleRate = AUDIO_CONFIG.SAMPLE_RATE, 
      bufferSize = AUDIO_CONFIG.BUFFER_SIZE,
      onChunk,
      onRawChunk,
      onAudioStreamEnd,
      onVolumeChange,
      isSystemAudio = false
    } = options;

    isRecordingActiveRef.current = true;

    try {
      let stream: MediaStream;
      console.log(`[AUDIO_RECORDER] Starting recording. System Audio: ${isSystemAudio}`);
      
      if (isSystemAudio) {
        // Use the centralized electronService to get the system audio source ID.
        // This is necessary for capturing desktop audio on Electron.
        const sourceId = await electronService.getSystemAudioSourceId();
        if (!isRecordingActiveRef.current) {
          console.log("[AUDIO_RECORDER] Start canceled: recording active flag is false after source ID fetch.");
          return false;
        }
        console.log(`[AUDIO_RECORDER] System audio source ID obtained:`, sourceId);
        if (!sourceId) throw new Error("Audio source not found");

        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            // @ts-ignore - Electron-specific constraints for desktop capture
            mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId }
          },
          video: {
            // @ts-ignore - Video track is needed to get the audio stream from the desktop
            mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId }
          }
        });
        if (!isRecordingActiveRef.current) {
          console.log("[AUDIO_RECORDER] Start canceled: recording active flag is false after getUserMedia.");
          stream.getTracks().forEach(t => t.stop());
          return false;
        }
        // We only want the audio, so we stop the video tracks immediately.
        stream.getVideoTracks().forEach(t => t.stop());
      } else {
        // Standard microphone capture.
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!isRecordingActiveRef.current) {
          console.log("[AUDIO_RECORDER] Start canceled: recording active flag is false after getUserMedia.");
          stream.getTracks().forEach(t => t.stop());
          return false;
        }
      }

      console.log(`[AUDIO_RECORDER] MediaStream obtained. Active tracks:`, stream.getAudioTracks().length);
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate });
      await audioContext.resume();
      if (!isRecordingActiveRef.current) {
        console.log("[AUDIO_RECORDER] Start canceled: recording active flag is false after resume AudioContext.");
        audioContext.close();
        stream.getTracks().forEach(t => t.stop());
        return false;
      }
      audioContextRef.current = audioContext;

      const liveChunkTargetSamples = Math.max(
        1,
        Math.round(sampleRate * (LIVE_TRANSCRIPTION_CHUNK_MS / 1000))
      );
      const workletBufferSize = onChunk ? liveChunkTargetSamples : bufferSize;

      const workletCode = `
        class VoiceProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            this.buffer = [];
            this.bufferSize = ${workletBufferSize};
          }
          process(inputs) {
            const input = inputs[0];
            if (input && input.length > 0) {
              const samples = input[0];
              for (let i = 0; i < samples.length; i++) {
                this.buffer.push(samples[i]);
              }
              if (this.buffer.length >= this.bufferSize) {
                this.port.postMessage(new Float32Array(this.buffer));
                this.buffer = [];
              }
            }
            return true;
          }
        }
        registerProcessor('voice-processor', VoiceProcessor);
      `;
      
      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await audioContext.audioWorklet.addModule(url);
      if (!isRecordingActiveRef.current) {
        console.log("[AUDIO_RECORDER] Start canceled: recording active flag is false after addModule.");
        audioContext.close();
        stream.getTracks().forEach(t => t.stop());
        return false;
      }
      console.log(`[AUDIO_RECORDER] Audio worklet module loaded.`);

      const source = audioContext.createMediaStreamSource(stream);
      const gainNode = audioContext.createGain();
      const sinkNode = audioContext.createGain();
      sinkNode.gain.value = 0;
      gainNodeRef.current = gainNode;
      sinkNodeRef.current = sinkNode;

      const workletNode = new AudioWorkletNode(audioContext, 'voice-processor');
      processorRef.current = workletNode;

      const silenceCountRef = { current: 0 };
      const chunkDurationMs = (workletBufferSize / sampleRate) * 1000;
      const HANGOVER_CHUNKS = Math.max(1, Math.ceil(SILENCE_HANGOVER_MS / chunkDurationMs));
      const PRE_ROLL_SAMPLES = Math.round(sampleRate * (SPEECH_PRE_ROLL_MS / 1000));
      let hasOpenAudioStream = false;
      let speechActive = false;
      let noiseFloor = AUDIO_CONFIG.NOISE_THRESHOLD / NOISE_FLOOR_MULTIPLIER;
      let lastActivityLogAt = 0;
      let lastSendLogAt = 0;
      let liveChunks: Float32Array[] = [];
      let liveChunkSampleCount = 0;
      let preRollChunks: Float32Array[] = [];
      let preRollSampleCount = 0;

      const pushPreRoll = (samples: Float32Array) => {
        preRollChunks.push(samples);
        preRollSampleCount += samples.length;
        while (
          preRollSampleCount > PRE_ROLL_SAMPLES
          && preRollChunks.length > 1
        ) {
          preRollSampleCount -= preRollChunks[0].length;
          preRollChunks.shift();
        }
      };

      const consumePreRoll = () => {
        if (!preRollChunks.length) return;
        liveChunks.push(...preRollChunks);
        liveChunkSampleCount += preRollSampleCount;
        preRollChunks = [];
        preRollSampleCount = 0;
      };

      const flushLiveAudio = (force = false) => {
        if (!onChunk || liveChunkSampleCount === 0) return;
        if (!force && liveChunkSampleCount < liveChunkTargetSamples) return;

        const merged = new Float32Array(liveChunkSampleCount);
        let offset = 0;
        for (const chunk of liveChunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }

        liveChunks = [];
        liveChunkSampleCount = 0;

        const pcm16 = floatTo16BitPCM(merged);
        const base64 = arrayBufferToBase64(pcm16);
        chunkSeqRef.current++;

        const now = Date.now();
        if (chunkSeqRef.current === 1 || now - lastSendLogAt >= SEND_LOG_INTERVAL_MS) {
          const durationMs = Math.round((merged.length / sampleRate) * 1000);
          console.log(`[AUDIO_RECORDER] Sending chunk seq: ${chunkSeqRef.current}, duration: ${durationMs}ms`);
          lastSendLogAt = now;
        }

        onChunk(base64, chunkSeqRef.current);
        hasOpenAudioStream = true;
      };
      flushLiveAudioRef.current = () => flushLiveAudio(true);

      workletNode.port.onmessage = (e) => {
        if (!isRecordingActiveRef.current) {
          return;
        }
        const samples = e.data as Float32Array;
        const rms = calculateRMS(samples);
        
        if (onVolumeChange) onVolumeChange(rms);
        if (onRawChunk) onRawChunk(samples);

        const threshold = Math.min(
          MAX_ACTIVITY_THRESHOLD,
          Math.max(MIN_ACTIVITY_THRESHOLD, noiseFloor * NOISE_FLOOR_MULTIPLIER)
        );
        const isSilent = rms <= threshold;

        if (!speechActive && isSilent) {
          noiseFloor = (noiseFloor * 0.97) + (rms * 0.03);
        }

        if (!isSilent) {
          if (!speechActive) {
            speechActive = true;
            consumePreRoll();
          }
          silenceCountRef.current = 0;
          if (onChunk) {
            liveChunks.push(samples);
            liveChunkSampleCount += samples.length;
            flushLiveAudio(false);
          }
        } else if (speechActive) {
          silenceCountRef.current++;
          if (silenceCountRef.current <= HANGOVER_CHUNKS) {
            if (onChunk) {
              liveChunks.push(samples);
              liveChunkSampleCount += samples.length;
              flushLiveAudio(false);
            }
          } else {
            flushLiveAudio(true);
            if (hasOpenAudioStream) {
              onAudioStreamEnd?.();
              hasOpenAudioStream = false;
            }
            speechActive = false;
            silenceCountRef.current = 0;
            preRollChunks = [];
            preRollSampleCount = 0;
            pushPreRoll(samples);
          }
        } else {
          pushPreRoll(samples);
        }
        
        // Keep a low-frequency activity log so long sessions do not flood the terminal.
        const now = Date.now();
        if (now - lastActivityLogAt >= ACTIVITY_LOG_INTERVAL_MS) {
          console.log(`[AUDIO_RECORDER] Activity Check - RMS: ${rms.toFixed(4)}, Noise floor: ${noiseFloor.toFixed(4)}, Threshold: ${threshold.toFixed(4)}, Silent: ${isSilent}, Active: ${speechActive}, Hangover: ${silenceCountRef.current}/${HANGOVER_CHUNKS}`);
          lastActivityLogAt = now;
        }
      };

      source.connect(gainNode);
      gainNode.connect(workletNode);
      workletNode.connect(sinkNode);
      sinkNode.connect(audioContext.destination);

      console.log(`[AUDIO_RECORDER] Recording pipeline connected successfully.`);

      return true;
    } catch (err) {
      console.error('[AUDIO_RECORDER] Start error:', err);
      stopRecording();
      return false;
    }
  }, [stopRecording]);

  return {
    startRecording,
    stopRecording,
    gainNode: gainNodeRef.current
  };
};
