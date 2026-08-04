const { ipcMain } = require('electron');
const store = require('../store/jsonStore');
const appState = require('../appState');
const logger = require('../services/logger');
const aiService = require('../services/aiService');

/**
 * Registers IPC handlers for chat-related functionality, including history and token usage.
 */
function registerChatHandlers() {
  ipcMain.handle('openai-chat-stream', async (event, args = {}) => {
    try {
      const streamId = String(args.streamId || 'openai-chat');
      const result = await aiService.streamChat(args, delta => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('openai-chat-stream-event', { streamId, type: 'delta', text: delta });
        }
      });
      if (!event.sender.isDestroyed()) {
        event.sender.send('openai-chat-stream-event', { streamId, type: 'end', text: result.text });
      }
      return { success: true, data: result };
    } catch (error) {
      logger.error('OPENAI_CHAT', 'stream error', error);
      return { success: false, error: error.message };
    }
  });

  // --- History ---
  ipcMain.handle('get-chat-history', () => {
    return { success: true, data: store.getChatHistory() };
  });

  ipcMain.on('save-chat-history', (event, history) => {
    store.saveChatHistory(history);
  });

  ipcMain.handle('end-session', async (event, type, historyOverride) => {
    try {
      const isSusurro = type === 'susurro';
      const hasHistoryOverride = Array.isArray(historyOverride);
      const history = hasHistoryOverride
        ? historyOverride
        : (isSusurro ? store.getSusurroHistory() : store.getChatHistory());

      if (!history || history.length === 0) {
        return { success: true, data: { message: 'No active session' } };
      }

      // UI clears immediately to avoid delay
      if (isSusurro) {
        if (!hasHistoryOverride) store.saveSusurroHistory([]);
      } else {
        if (!hasHistoryOverride) store.saveChatHistory([]);
        appState.chatHasMessages = false;
        const windowManager = require('../windows/windowManager');
        const chatWin = windowManager.get('chat');
        if (chatWin && !chatWin.isDestroyed()) {
          chatWin.hide();
        }
      }

      const windowManager = require('../windows/windowManager');
      const cmdWin = windowManager.get('command');
      if (cmdWin && !cmdWin.isDestroyed()) {
        cmdWin.webContents.send('focus-input');
        cmdWin.focus(); // Ensure it receives OS-level focus if possible
      }

      // Run AI session generation asynchronously without blocking the UI
      let firstMessageContent = 'Nova Sessão';
      const firstUserMessage = isSusurro
        ? history.find(msg => msg.text || msg.pendingText || msg.content)
        : history.find(msg => msg.role === 'user' || msg.sender === 'user');
      if (firstUserMessage) {
        if (firstUserMessage.parts) {
          const textPart = firstUserMessage.parts.find(p => p.text);
          if (textPart) firstMessageContent = textPart.text;
        } else if (firstUserMessage.text) {
          firstMessageContent = firstUserMessage.text;
        } else if (firstUserMessage.pendingText) {
          firstMessageContent = firstUserMessage.pendingText;
        } else if (firstUserMessage.content) {
          firstMessageContent = firstUserMessage.content;
        }
      }

      const title = await aiService.generateSessionTitle(firstMessageContent);

      const session = {
        id: Date.now().toString(),
        title,
        type: type || 'minichat',
        timestamp: new Date().toISOString(),
        messages: history
      };

      const sessions = store.getSessions();
      sessions.push(session);
      store.saveSessions(sessions);

      if (isSusurro) {
        const hermesService = require('../services/hermesService');
        hermesService.summarizeMeeting(session).catch(error => {
          logger.error('HERMES', 'meeting summary error', error);
        });
      }

      return { success: true, data: session };
    } catch (error) {
      logger.error('IPC', 'end-session error', error);
      return { success: false, error: error.message };
    }
  });

  // --- Token Management ---
  ipcMain.handle('update-tokens', (event, count) => {
    try {
      const total = store.getTotalTokens() + (count || 0);
      store.saveTokens(total);
      return { success: true, data: total };
    } catch (error) {
      logger.error('IPC', 'update-tokens error', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-total-tokens', () => {
    return { success: true, data: store.getTotalTokens() };
  });

  // --- Status ---
  ipcMain.on('chat-status-update', (event, { hasMessages }) => {
    appState.chatHasMessages = hasMessages;
  });
}

module.exports = registerChatHandlers;
