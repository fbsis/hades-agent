import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('./workSyncService.js', import.meta.url), 'utf8');
function setup() {
  const created = [];
  let settings = { workSync: { baseURL: 'https://example.invalid', workspaces: [{ id: 'w1', name: 'Test', token: 'test-only' }], windows: {} } };
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.visible = false;
      this.destroyed = false;
      this.protected = false;
      this.setContentProtection = vi.fn(value => { this.protected = value; });
      this.webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler: vi.fn(),
        getURL: () => this.url || ''
      });
      created.push(this);
    }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    isFocused() { return this.visible; }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    getBounds() { return { x: 0, y: 0, width: 500, height: 500 }; }
    show() { expect(this.protected).toBe(true); this.visible = true; this.emit('show'); }
    hide() { this.visible = false; this.emit('hide'); }
    focus() { this.emit('focus'); }
    loadURL(url) { expect(this.protected).toBe(true); this.url = url; return Promise.resolve(); }
    loadFile() { expect(this.protected).toBe(true); return Promise.resolve(); }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const dependencies = {
    electron: {
      BrowserWindow: Window,
      app: {},
      screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }), getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
      session: { fromPartition: () => ({ setPermissionRequestHandler() {}, webRequest: { onBeforeSendHeaders() {} } }) },
      globalShortcut: { register: () => true, isRegistered: () => false, unregister() {} }
    },
    '../store/jsonStore': { getSettings: () => settings, saveSettings: value => { settings = value; } },
    './workspaceProvisioning': { createProvisioner: () => ({ snapshot: () => ({}) }) }
  };
  const context = {
    module: { exports: {} },
    __dirname: fileURLToPath(new URL('.', import.meta.url)),
    require: name => dependencies[name] || require(name),
    process: { platform: 'darwin' }, URL,
    setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args)
  };
  vm.runInNewContext(source, context, { filename: 'workSyncService.js' });
  return { service: context.module.exports, created };
}

describe('web integration window capture protection', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it.each(['notes', 'full'])('protects %s before navigation and first display, including reuse and preferences', mode => {
    const { service, created } = setup();
    service.open('w1', mode);
    const win = created[0];
    expect(win.options.show).toBe(false);
    expect(win.protected).toBe(true);
    win.emit('ready-to-show');
    expect(win.visible).toBe(true);
    service.preferences(`w1:${mode}`, { pinned: true, allSpaces: true, autoHide: false });
    vi.advanceTimersByTime(1500);
    win.hide();
    win.protected = false; // Simulate a native compositor reset before reusing the window.
    service.open('w1', mode);
    expect(created).toHaveLength(1);
    expect(win.protected).toBe(true);
    for (const event of ['focus', 'restore']) {
      win.protected = false;
      win.emit(event);
      expect(win.protected).toBe(true);
    }
    win.protected = false;
    win.webContents.emit('did-finish-load');
    expect(win.protected).toBe(true);
    expect(win.setContentProtection.mock.calls.every(([value]) => value === true)).toBe(true);
  });

  it('opens multiple isolated note windows without replacing an unsaved editor', () => {
    const { service, created } = setup();
    service.open('w1', 'notes');
    service.open('w1', 'notes', false, 'second-window');
    expect(created).toHaveLength(2);
    expect(created.every(win => win.protected)).toBe(true);
    expect(created[0].options.webPreferences.partition).toBe(created[1].options.webPreferences.partition);
    expect(created[1].options.webPreferences.preload).toContain('notes-preload.js');
    expect(created[1].options.webPreferences.nodeIntegration).toBe(false);
    expect(created[1].options.skipTaskbar).toBe(true);
  });

  it('protects integration settings before loading/showing and when reopened', () => {
    const { service, created } = setup();
    service.openPanel();
    const win = created[0];
    expect(win.options.show).toBe(false);
    expect(win.visible).toBe(false);
    expect(win.protected).toBe(true);
    win.emit('ready-to-show');
    win.hide();
    win.protected = false;
    service.openPanel();
    expect(created).toHaveLength(1);
    expect(win.visible).toBe(true);
    expect(win.protected).toBe(true);
  });
});
