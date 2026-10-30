import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import bookmark from './textSelectionBookmark';
function setup() {
  const node = { tagName: 'TEXTAREA', type: 'textarea', isConnected: true, value: 'Antes ORIGINAL depois', selectionStart: 6, selectionEnd: 14, focus() {}, setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } };
  let calls = 0;
  const document = { activeElement: node, execCommand(command, _ui, text) { calls++; expect(command).toBe('insertText'); node.value = node.value.slice(0, node.selectionStart) + text + node.value.slice(node.selectionEnd); return true; } };
  const context = vm.createContext({ document });
  const win = { isDestroyed: () => false, webContents: { isDestroyed: () => false, executeJavaScriptInIsolatedWorld: async (_world, scripts) => vm.runInContext(scripts[0].code, context) } };
  return { win, node, document, context, calls: () => calls };
}
describe('owner-bound native editor replacement', () => {
  it('replaces only the original range once, without clipboard or Accessibility', async () => {
    const f = setup(), captured = await bookmark.captureBookmark(f.win, 'ORIGINAL');
    expect(await captured.replace('EDITADO')).toBe(true);
    expect(f.node.value).toBe('Antes EDITADO depois');
    expect(await captured.replace('duplicado')).toBe(false);
    expect(f.calls()).toBe(1);
  });
  it('refuses a moved selection', async () => {
    const f = setup(), captured = await bookmark.captureBookmark(f.win, 'ORIGINAL');
    f.node.selectionStart = 0;
    expect(await captured.replace('EDITADO')).toBe(false);
    expect(f.node.value).toBe('Antes ORIGINAL depois'); expect(f.calls()).toBe(0);
  });
  it('refuses changes elsewhere in the same field', async () => {
    const f = setup(), captured = await bookmark.captureBookmark(f.win, 'ORIGINAL');
    f.node.value += '!'; expect(await captured.replace('EDITADO')).toBe(false); expect(f.calls()).toBe(0);
  });
  it('never inserts into another field', async () => {
    const f = setup(), captured = await bookmark.captureBookmark(f.win, 'ORIGINAL');
    f.document.activeElement = {}; expect(await captured.replace('EDITADO')).toBe(false); expect(f.calls()).toBe(0);
  });
  it('rejects disconnected, readonly or closed sources', async () => {
    for (const change of [f => { f.node.isConnected = false; }, f => { f.node.readOnly = true; }, f => { f.win.isDestroyed = () => true; }]) {
      const f = setup(), captured = await bookmark.captureBookmark(f.win, 'ORIGINAL'); change(f);
      expect(await captured.replace('EDITADO')).toBe(false); expect(f.calls()).toBe(0);
    }
  });
  it('rejects passwords and mismatched selections', async () => {
    const f = setup(); expect(await bookmark.captureBookmark(f.win, 'diferente')).toBeNull();
    f.node.type = 'password'; expect(await bookmark.captureBookmark(f.win, 'ORIGINAL')).toBeNull();
  });
  it('invalidates an older operation when another menu captures the same field', async () => {
    const f = setup(), old = await bookmark.captureBookmark(f.win, 'ORIGINAL');
    const current = await bookmark.captureBookmark(f.win, 'ORIGINAL');
    expect(await old.replace('ANTIGO')).toBe(false);
    expect(await current.replace('ATUAL')).toBe(true); expect(f.calls()).toBe(1);
  });
  it('inserts AI output as literal plain text, never executable code or HTML', async () => {
    const f = setup(), captured = await bookmark.captureBookmark(f.win, 'ORIGINAL');
    const text = '\"; globalThis.BAD=1; // </script><img src=x onerror=BAD()>´';
    expect(await captured.replace(text)).toBe(true); expect(f.node.value).toBe(`Antes ${text} depois`); expect(f.context.BAD).toBeUndefined();
  });
});
