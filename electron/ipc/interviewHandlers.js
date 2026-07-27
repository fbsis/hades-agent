const { desktopCapturer, ipcMain } = require('electron');
const geminiLiveService = require('../services/geminiLiveService');
const interviewRecordingService = require('../services/interviewRecordingService');
const interviewService = require('../services/interviewService');
const logger = require('../services/logger');

function wrap(handler) {
  return async (event, ...args) => {
    try {
      const data = await handler(event, ...args);
      return { success: true, data };
    } catch (error) {
      logger.error('INTERVIEW_IPC', 'handler error', error);
      return { success: false, error: error.message };
    }
  };
}

function registerInterviewHandlers() {
  ipcMain.handle('interview-create-session', wrap((event, config) => (
    interviewService.createSession(config || {})
  )));

  ipcMain.handle('interview-list-sessions', wrap(() => interviewService.listSessions()));

  ipcMain.handle('interview-load-session', wrap((event, sessionId) => (
    interviewService.getSession(sessionId)
  )));

  ipcMain.handle('interview-update-session', wrap((event, sessionId, patch) => (
    interviewService.updateSession(sessionId, patch || {})
  )));

  ipcMain.handle('interview-finish-session', wrap(async (event, sessionId) => {
    await geminiLiveService.stopSession(sessionId);
    await interviewRecordingService.stopSession(sessionId);
    return interviewService.finishSession(sessionId);
  }));

  ipcMain.handle('interview-archive-session', wrap((event, sessionId) => (
    interviewService.archiveSession(sessionId)
  )));

  ipcMain.handle('interview-save-turn', wrap((event, sessionId, turn) => (
    interviewService.upsertTurn(sessionId, turn)
  )));

  ipcMain.handle('interview-start-source', wrap((event, options) => (
    geminiLiveService.startSource(event, options || {})
  )));

  ipcMain.handle('interview-stop-source', wrap((event, sessionId, source) => (
    geminiLiveService.stopSource(sessionId, source)
  )));

  ipcMain.handle('interview-stop-transcription', wrap((event, sessionId) => (
    geminiLiveService.stopSession(sessionId)
  )));

  ipcMain.on('interview-send-audio-chunk', (event, payload) => {
    geminiLiveService.sendChunk(payload || {});
  });

  ipcMain.on('interview-audio-stream-end', (event, sessionId, source) => {
    geminiLiveService.sendAudioStreamEnd(sessionId, source, 'renderer_pause');
  });

  ipcMain.handle('interview-request-answer', wrap((event, args) => (
    interviewService.streamAnswer(args || {}, payload => {
      if (event.sender.isDestroyed()) return;
      event.sender.send('interview-answer-event', payload);
    })
  )));

  ipcMain.handle('interview-cancel-answer', wrap((event, answerId) => (
    interviewService.cancelAnswer(answerId)
  )));

  ipcMain.handle('interview-analyze-screen', wrap(async (event, question) => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    });
    const images = sources.map(source => source.thumbnail.toDataURL());
    return interviewService.analyzeScreen(images, question);
  }));

  ipcMain.handle('interview-recording-start', wrap((event, sessionId, source) => (
    interviewRecordingService.start(sessionId, source)
  )));

  ipcMain.on('interview-recording-chunk', (event, sessionId, source, base64) => {
    interviewRecordingService.append(sessionId, source, base64);
  });

  ipcMain.handle('interview-recording-stop', wrap((event, sessionId, source) => (
    interviewRecordingService.stop(sessionId, source)
  )));
}

module.exports = registerInterviewHandlers;
