import { describe, expect, it } from 'vitest';
import memoryModule from './recordedMeetingMemory.js';

const {
  buildRecordedMeetingMemoryPrompt,
  buildRecordedMeetingSummaryInput,
  clipMeetingText,
  hasSavedRecording,
  shouldSyncRecordedMeeting
} = memoryModule;

const recordedSession = {
  id: 'meeting-123',
  status: 'completed',
  title: 'Architecture review',
  startedAt: '2026-08-03T10:00:00.000Z',
  endedAt: '2026-08-03T11:00:00.000Z',
  hasRecording: true,
  config: {
    mode: 'meeting',
    retainAudio: true,
    company: 'Acme',
    description: 'Review the queue strategy.'
  },
  transcript: [
    { source: 'interviewer', text: 'Vamos usar entrega pelo menos uma vez.', pendingText: '' },
    { source: 'candidate', text: 'Vou documentar os casos de duplicacao.', pendingText: '' }
  ],
  audioArtifacts: [{ bytes: 32000 }]
};

describe('recorded meeting memory', () => {
  it('queues every completed recorded session with transcript content', () => {
    expect(hasSavedRecording(recordedSession)).toBe(true);
    expect(shouldSyncRecordedMeeting(recordedSession)).toBe(true);
    expect(shouldSyncRecordedMeeting({ ...recordedSession, status: 'active' })).toBe(false);
    expect(shouldSyncRecordedMeeting({
      ...recordedSession,
      hermesMemory: { status: 'synced' }
    })).toBe(false);
  });

  it('builds a compact transcript input for OpenAI summarization', () => {
    const result = buildRecordedMeetingSummaryInput(recordedSession);

    expect(result.input).toContain('Empresa ou pessoa: Acme');
    expect(result.input).toContain('Outra pessoa: Vamos usar entrega');
    expect(result.input).toContain('Usuario: Vou documentar');
  });

  it('sends only the filtered summary to Hermes memory', () => {
    const result = buildRecordedMeetingMemoryPrompt(
      recordedSession,
      '- Decisao: usar entrega pelo menos uma vez.'
    );

    expect(result.memoryId).toBe('metis-recorded-session:meeting-123');
    expect(result.prompt).toContain('Empresa ou pessoa: Acme');
    expect(result.prompt).toContain('Decisao: usar entrega pelo menos uma vez.');
    expect(result.prompt).not.toContain('Outra pessoa: Vamos usar entrega');
    expect(result.prompt).not.toContain('<transcricao');
  });

  it('preserves the beginning and end when compacting a long transcript', () => {
    const compact = clipMeetingText(`BEGIN-${'x'.repeat(200)}-END`, 80);
    expect(compact).toContain('BEGIN-');
    expect(compact).toContain('-END');
    expect(compact).toContain('trecho intermediario omitido');
  });
});
