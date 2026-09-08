const { ipcMain, systemPreferences } = require('electron');
const logger = require('../services/logger');

const getMicrophoneAccess = () => {
  if (process.platform !== 'darwin') {
    return { granted: true, status: 'granted' };
  }

  const status = systemPreferences.getMediaAccessStatus('microphone');
  return { granted: status === 'granted', status };
};

function registerMediaPermissionHandlers() {
  ipcMain.handle('media-request-microphone-access', async () => {
    try {
      const current = getMicrophoneAccess();
      logger.info('MEDIA', `Microphone permission check: ${current.status}`);
      if (
        process.platform !== 'darwin'
        || !['not-determined', 'unknown'].includes(current.status)
      ) {
        return { success: true, data: current };
      }

      const granted = await systemPreferences.askForMediaAccess('microphone');
      const updated = getMicrophoneAccess();
      logger.info('MEDIA', `Microphone permission requested: ${updated.status}`);
      const effectiveStatus = updated.status === 'unknown'
        ? (granted ? 'granted' : 'denied')
        : updated.status;
      return {
        success: true,
        data: { granted: granted || updated.status === 'granted', status: effectiveStatus }
      };
    } catch (error) {
      logger.error('MEDIA', 'Could not request microphone permission', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = registerMediaPermissionHandlers;
