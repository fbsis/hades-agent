const { BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron');
const googleCloudAuthService = require('../services/googleCloudAuthService');
const interviewRecordingService = require('../services/interviewRecordingService');
const interviewService = require('../services/interviewService');
const interviewTranscriptionService = require('../services/interviewTranscriptionService');
const logger = require('../services/logger');
const {
  getDisplayThumbnailSize,
  selectDisplaySource
} = require('../services/screenCaptureSelection');
const windowManager = require('../windows/windowManager');

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
  ipcMain.handle('google-cloud-auth-status', wrap(() => (
    googleCloudAuthService.getStatus()
  )));

  ipcMain.handle('google-cloud-auth-login', wrap((event, projectId) => (
    googleCloudAuthService.login(projectId)
  )));

  ipcMain.handle('interview-create-session', wrap((event, config, options) => (
    interviewService.createSession(config || {}, options || {})
  )));

  ipcMain.handle('interview-list-sessions', wrap(() => interviewService.listSessions()));

  ipcMain.handle('interview-load-session', wrap((event, sessionId) => (
    interviewService.getSession(sessionId)
  )));

  ipcMain.handle('interview-update-session', wrap((event, sessionId, patch) => (
    interviewService.updateSession(sessionId, patch || {})
  )));

  ipcMain.handle('interview-finish-session', wrap(async (event, sessionId) => {
    await interviewTranscriptionService.stopSession(sessionId);
    await interviewRecordingService.stopSession(sessionId);
    return interviewService.finishSession(sessionId);
  }));

  ipcMain.handle('interview-archive-session', wrap((event, sessionId) => (
    interviewService.archiveSession(sessionId)
  )));

  ipcMain.handle('interview-delete-session', wrap(async (event, sessionId) => {
    await interviewTranscriptionService.stopSession(sessionId);
    await interviewRecordingService.stopSession(sessionId);
    return interviewService.deleteSession(sessionId);
  }));

  ipcMain.handle('interview-summarize-session', wrap((event, sessionId) => (
    interviewService.summarizeSession(sessionId)
  )));

  ipcMain.handle('interview-save-turn', wrap((event, sessionId, turn) => (
    interviewService.upsertTurn(sessionId, turn)
  )));

  ipcMain.handle('interview-start-source', wrap((event, options) => (
    interviewTranscriptionService.startSource(event, options || {})
  )));

  ipcMain.handle('interview-stop-source', wrap((event, sessionId, source) => (
    interviewTranscriptionService.stopSource(sessionId, source)
  )));

  ipcMain.handle('interview-stop-transcription', wrap((event, sessionId) => (
    interviewTranscriptionService.stopSession(sessionId)
  )));

  ipcMain.on('interview-send-audio-chunk', (event, payload) => {
    interviewTranscriptionService.sendChunk(payload || {});
  });

  ipcMain.on('interview-audio-stream-end', (event, sessionId, source) => {
    interviewTranscriptionService.sendAudioStreamEnd(sessionId, source, 'renderer_pause');
  });

  ipcMain.handle('interview-flush-transcription', wrap((event, sessionId, source) => (
    interviewTranscriptionService.flushForAnswer(sessionId, source)
  )));

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
    const requestingWindow = BrowserWindow.fromWebContents(event.sender);
    const floatingHead = windowManager.get('floatingHead');
    const floatingHeadVisible = floatingHead
      && !floatingHead.isDestroyed()
      && floatingHead.isVisible();
    const anchorWindow = requestingWindow && !requestingWindow.isDestroyed() && requestingWindow.isVisible()
      ? requestingWindow
      : floatingHeadVisible
        ? floatingHead
        : requestingWindow;
    const displays = screen.getAllDisplays();
    const targetDisplay = anchorWindow && !anchorWindow.isDestroyed()
      ? screen.getDisplayMatching(anchorWindow.getBounds())
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: getDisplayThumbnailSize(targetDisplay)
    });
    const source = selectDisplaySource(sources, targetDisplay, displays);
    if (!source) throw new Error('Nenhuma tela disponivel para captura.');
    logger.info(
      'INTERVIEW_IPC',
      `Capturing display ${targetDisplay.id} from source ${source.id} (${source.name}).`
    );
    return interviewService.analyzeScreen([source.thumbnail.toDataURL()], question);
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
