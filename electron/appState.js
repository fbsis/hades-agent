const store = require('./store/jsonStore');

class AppState {
  chatHasMessages = false;
  isCommandPinned = true;
  isChatPinned = false;
  isSusurroPinned = false;
  isSusurroTranscribing = false;
  isQuitting = false;
  isFileDialogOpen = false;
  pendingCommandPanel = null;

  constructor() {
    const history = store.getChatHistory();
    this.chatHasMessages = Array.isArray(history) && history.length > 0;
  }
}

module.exports = new AppState();
