const crypto = require('node:crypto');
const { DEFAULT_CONFIG } = require('./interviewPrompt');
function createQuickMeeting({ getSettings, getSessions, show, notify, now = () => new Date(), id = () => crypto.randomUUID() }) {
  let pending;
  return {
    request(workspace) {
      const company = getSettings().workSync?.workspaces?.find(w => w.id === workspace && !w.archived);
      if (!company) throw new Error('Empresa não disponível neste computador.');
      if (pending || getSessions().some(s => s.status === 'active' && !s.isTestMode)) throw new Error('Já existe uma reunião em andamento ou abrindo. Encerre-a antes de iniciar outra.');
      pending = { id: id(), config: {
        ...DEFAULT_CONFIG, mode: 'meeting', workspaceId: company.id, company: company.name,
        title: `${company.name} · Reunião rápida · ${now().toLocaleString('pt-BR')}`,
        quickMeeting: true, learnAfterFinish: true, syncTranscript: false,
        saveTranscript: true, retainAudio: true, transcribeMicrophone: true,
        contextDocumentIds: []
      } };
      try { show(); notify(pending); }
      catch (error) { pending = undefined; throw error; }
      return { queued: true };
    },
    peek: () => pending || null,
    acknowledge(identifier) { if (pending?.id === identifier) pending = undefined; }
  };
}
function workspaceForEvent(event, windows, baseURL) {
  if (event.senderFrame !== event.sender.mainFrame) throw new Error('Frame não autorizado.');
  const entry = [...windows].find(([, win]) => !win.isDestroyed() && win.webContents === event.sender);
  if (!entry || new URL(event.senderFrame.url).origin !== baseURL) throw new Error('Janela não autorizada.');
  return entry[0].split(':')[0];
}
module.exports = { createQuickMeeting, workspaceForEvent };
