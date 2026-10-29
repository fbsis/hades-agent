const { contextBridge, ipcRenderer } = require('electron');
// No credentials, Node access, workspace selector or generic IPC channel in remote content.
contextBridge.exposeInMainWorld('metisNotes', {
  newWindow: () => ipcRenderer.invoke('metis-notes:action', 'new-window'),
  quickMeeting: () => ipcRenderer.invoke('metis-notes:action', 'quick-meeting')
});
