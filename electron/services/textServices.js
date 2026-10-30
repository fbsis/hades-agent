const { app, globalShortcut, dialog, systemPreferences } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createBridge, privateDirectory } = require('./textServiceBridge');
const { SERVICES, installWorkflows, isManaged, servicePath } = require('./textServiceWorkflow');
const store = require('../store/jsonStore');
const exec = promisify(execFile);
const supported = () => process.platform === 'darwin' && Number(require('node:os').release().split('.')[0]) >= 23;
let bridge, configPath, helper, started, startError;
const serviceDirectory = () => path.join(app.getPath('home'), 'Library/Services');
async function start() {
  if (!supported()) return;
  if (started) return started;
  started = (async () => {
    const directory = path.join(app.getPath('userData'), 'text-services');
    privateDirectory(directory);
    configPath = path.join(directory, 'bridge.json');
    let token;
    if (fs.existsSync(configPath)) {
      if (fs.lstatSync(configPath).isSymbolicLink()) throw new Error('Configuração de integração inválida.');
      try { token = JSON.parse(fs.readFileSync(configPath, 'utf8')).token; } catch {}
    }
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) token = crypto.randomBytes(32).toString('hex');
    const profileHash = crypto.createHash('sha256').update(app.getPath('userData')).digest('hex').slice(0, 12);
    const socket = `/tmp/metis-text-${process.getuid()}-${profileHash}/bridge.sock`;
    helper = app.isPackaged ? path.join(process.resourcesPath, 'text-actions/metis-text-service') : path.join(app.getAppPath(), 'resources/text-actions/metis-text-service');
    const marker = process.execPath.indexOf('.app/Contents/');
    if (marker < 0) throw new Error('Bundle macOS não encontrado.');
    const bundle = process.execPath.slice(0, marker + 4);
    const launchArgs = app.isPackaged ? [] : [process.argv[1] || app.getAppPath()];
    const temporary = configPath + '.new';
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, socket, token, bundle, launchArgs }), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, configPath);
    bridge = createBridge({ socketPath: socket, token, run: args => require('./textActionService').runTextAction(args) });
    await bridge.start();
  })().catch(() => { startError = 'Não foi possível preparar a comunicação local. Reinicie o Metis.'; });
  return started;
}
async function status() {
  await start();
  return {
    supported: supported(),
    shortcut: store.getSettings().shortcuts?.selectedTextActions || 'Alt+Space',
    shortcutRegistered: globalShortcut.isRegistered(store.getSettings().shortcuts?.selectedTextActions || 'Alt+Space'),
    openaiConfigured: !!store.getSettings().general?.openaiApiKey,
    accessibility: process.platform === 'darwin' && systemPreferences.isTrustedAccessibilityClient(false),
    servicesInstalled: process.platform === 'darwin' ? SERVICES.filter(service => isManaged(servicePath(serviceDirectory(), service))).length : 0,
    helperReady: !!helper && fs.existsSync(helper),
    error: startError || ''
  };
}
async function refreshServices() {
  try { await exec('/System/Library/CoreServices/pbs', ['-flush', '-update'], { timeout: 8000 }); }
  catch { /* Files remain installed; macOS may refresh on the next session. */ }
}
async function configure(parent) {
  if (!supported()) throw new Error('O menu Serviços do Metis exige macOS 14 ou mais recente.');
  const answer = await dialog.showMessageBox(parent, {
    type: 'question', buttons: ['Configurar neste Mac', 'Cancelar'], defaultId: 1, cancelId: 1,
    message: 'Ativar ações de texto do Metis neste computador?',
    detail: 'Instala/atualiza apenas três Serviços Metis (Traduzir, Corrigir e Reescrever) e define Option+Espaço. O texto selecionado será enviado à OpenAI somente ao escolher uma ação e o resultado será devolvido diretamente ao editor. Não altera WritingTools nem importa chaves. Permissões e a ativação dos Serviços no macOS continuam sob seu controle.'
  });
  if (answer.response !== 0) return { cancelled: true, ...await status() };
  await start();
  if (startError) throw new Error(startError);
  if (!fs.existsSync(helper)) {
    if (app.isPackaged) throw new Error('Auxiliar nativo ausente. Instale uma versão do Metis que inclua os Serviços de texto.');
    try { await require('../../scripts/build-text-services').buildHelper(); }
    catch { throw new Error('No dev, o auxiliar precisa do Xcode Command Line Tools instalado. Nenhum instalador é executado pelo Metis.'); }
  }
  installWorkflows(serviceDirectory(), helper, configPath);
  await refreshServices();
  const settings = store.getSettings();
  store.saveSettings({ ...settings, shortcuts: { ...settings.shortcuts, selectedTextActions: 'Alt+Space' } });
  require('../shortcuts')();
  return { ...await status(), message: 'Serviços instalados. Se não aparecerem, habilite-os em Ajustes do Sistema → Teclado → Atalhos de Teclado → Serviços.' };
}
async function remove(parent) {
  if (process.platform !== 'darwin') return;
  const answer = await dialog.showMessageBox(parent, { type: 'question', buttons: ['Remover Serviços Metis', 'Cancelar'], defaultId: 1, cancelId: 1, message: 'Remover os três itens de texto do menu Serviços?', detail: 'Não altera outros Serviços, a chave OpenAI ou os atalhos do Metis.' });
  if (answer.response !== 0) return { cancelled: true, ...await status() };
  for (const service of SERVICES) {
    const target = servicePath(serviceDirectory(), service);
    if (isManaged(target)) fs.rmSync(target, { recursive: true });
  }
  await refreshServices(); return status();
}
function stop() { return bridge?.stop(); }
module.exports = { start, stop, status, configure, remove };
