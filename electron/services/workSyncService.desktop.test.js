import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('./workSyncService.js', import.meta.url), 'utf8');
function setup() {
  let handler;
  const showCommandPanel = vi.fn();
  const fetch = vi.fn();
  const refresh = vi.fn(() => new Promise(() => {}));
  const trayCreated = vi.fn();
  const dependencies = {
    electron: {
      app: { on: vi.fn() },
      ipcMain: { handle: (name, fn) => { if (name === 'metis-work:command') handler = fn; } },
      nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
      Tray: class { constructor() { trayCreated(); } setToolTip() {} setContextMenu() {} },
      Menu: { buildFromTemplate: value => value }
    },
    '../store/jsonStore': { getSettings: () => ({ workSync: { baseURL: 'https://offline.invalid', workspaces: [], windows: {} } }) },
    './workspaceProvisioning': { createProvisioner: () => ({ refresh, snapshot: () => ({ server: { state: 'offline' } }) }) },
    '../windows/windowManager': { showCommandPanel }
  };
  const context = {
    module: { exports: {} },
    __dirname: fileURLToPath(new URL('.', import.meta.url)),
    require: name => dependencies[name] || require(name),
    fetch,
    process: { platform: 'darwin' },
    URL,
    setInterval: () => ({ unref() {} }),
    setTimeout: () => ({ unref() {} })
  };
  vm.runInNewContext(source, context, { filename: 'workSyncService.js' });
  context.module.exports.init();
  const frame = { url: new URL('../work/work-panel.html', import.meta.url).href };
  const event = { senderFrame: frame, sender: { mainFrame: frame } };
  return { handler, event, showCommandPanel, fetch, refresh, trayCreated };
}

describe('native entry independent of server availability', () => {
  it.each(['command', 'chat', 'settings'])('opens %s without waiting for the server or needing a company', async panel => {
    const { handler, event, showCommandPanel, fetch, refresh } = setup();
    expect(refresh).toHaveBeenCalledOnce();
    expect(await handler(event, 'desktop', { panel })).toEqual({ opened: panel });
    expect(showCommandPanel).toHaveBeenCalledWith(panel);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not create a menu-bar tray on macOS', () => {
    expect(setup().trayCreated).not.toHaveBeenCalled();
  });

  it('rejects arbitrary panels and remote callers', async () => {
    const { handler, event, showCommandPanel } = setup();
    await expect(handler(event, 'desktop', { panel: 'arbitrary' })).rejects.toThrow('Tela não permitida');
    event.senderFrame.url = 'https://offline.invalid';
    await expect(handler(event, 'desktop', { panel: 'command' })).rejects.toThrow('Origem não autorizada');
    expect(showCommandPanel).not.toHaveBeenCalled();
  });
});
