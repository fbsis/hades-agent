import { describe, it, expect, vi } from 'vitest';
import module from './selectedTextCore.js';
const { createSelectedTextService, SNAPSHOT_SCRIPT } = module;
const metadata = { pid: 99, bundleId: 'com.example.fixture', windowTitle: 'Fixture', field: 'body', editable: true, text: '  Texto original\n' };
function setup({ trusted = true, text = metadata.text, copiedText = 'Copiado da seleção' } = {}) {
  let value = 'Clipboard anterior';
  let current = { ...metadata, text };
  let identifier = 0;
  const clipboard = {
    readText: vi.fn(() => value), readHTML: () => '<b>Clipboard anterior</b>', readRTF: () => 'RTF original',
    readImage: () => ({ isEmpty: () => true }),
    writeText: vi.fn(text => { value = text; }), write: vi.fn(data => { value = data.text; })
  };
  const execute = vi.fn(async (script, args) => {
    if (script === SNAPSHOT_SCRIPT) return JSON.stringify(current);
    if (args[1] === 'copy') value = copiedText;
    return 'ok';
  });
  const service = createSelectedTextService({ clipboard, execute, trusted: () => trusted, platform: 'darwin', wait: async () => {}, id: () => `selection-${++identifier}` });
  return { service, clipboard, execute, current: update => { current = { ...current, ...update }; }, clipboardValue: () => value };
}
describe('selected text capture and safe replacement', () => {
  it('captures a Metis editor without Accessibility, Apple events or clipboard', async () => {
    const { service, execute, clipboard } = setup({ trusted: false });
    const replace = vi.fn(async () => true);
    const captured = await service.captureEditor(async () => ({ text: 'Original', replace }));
    expect(captured.canReplace).toBe(true);
    await service.replace('Transformado', captured.selectionId);
    expect(replace).toHaveBeenCalledWith('Transformado'); expect(execute).not.toHaveBeenCalled(); expect(clipboard.writeText).not.toHaveBeenCalled();
  });
  it('restores only the captured owner on close and forgets it after clearing', async () => {
    const { service } = setup(); const restore = vi.fn();
    await service.captureEditor(async () => ({ text: 'Original', replace: async () => true, restore }));
    service.restoreSource(); expect(restore).toHaveBeenCalledOnce();
    service.clear(); service.restoreSource(); expect(restore).toHaveBeenCalledOnce();
  });
  it('keeps preview source restoration without granting write access', async () => {
    const { service } = setup(); const restore = vi.fn();
    service.presentResult('Original', 'Resumo', '', restore); service.restoreSource();
    expect(restore).toHaveBeenCalledOnce(); expect(service.getSelection().canReplace).toBe(false);
    await expect(service.replace('x', service.getSelection().selectionId)).rejects.toThrow('indisponível');
  });
  it('does not activate an unknown window without a usable identity', async () => {
    const { service, current, execute } = setup(); current({ window: { title: '', identifier: '', frame: '' } });
    const captured = await service.capture(); expect(captured.canReplace).toBe(false);
    await expect(service.replace('x', captured.selectionId)).rejects.toThrow('indisponível');
    expect(execute.mock.calls.some(([, args]) => args[1] === 'activate')).toBe(false);
  });
  it('an empty Metis selection never falls back to copying/reactivating the app', async () => {
    const { service, execute, clipboard } = setup();
    await expect(service.captureEditor(async () => ({ text: '' }))).rejects.toThrow('Nenhum texto selecionado');
    expect(execute).not.toHaveBeenCalled(); expect(clipboard.writeText).not.toHaveBeenCalled();
  });
  it('never overwrites a newer capture with a slow earlier editor snapshot', async () => {
    const { service } = setup(); let ready;
    const pending = service.captureEditor(() => new Promise(resolve => { ready = resolve; }));
    service.presentResult('Mais recente', 'Resultado', ''); ready({ text: 'Antiga', replace: async () => true });
    await expect(pending).rejects.toThrow('mudou'); expect(service.getSelection().text).toBe('Mais recente');
  });
  it('waits for transient AX focus loss instead of rejecting after a fixed 150ms', async () => {
    const { service, execute } = setup(); const captured = await service.capture(); let calls = 0;
    execute.mockImplementation(async (script) => script === SNAPSHOT_SCRIPT ? JSON.stringify(++calls < 3 ? { ...metadata, editable: false, field: '' } : metadata) : 'ok');
    await service.replace('Transformado', captured.selectionId);
    expect(calls).toBe(3);
  });
  it('does not invalidate a stable window because its title changed', async () => {
    const { service, current } = setup();
    const window = { title: 'Documento', identifier: 'window-1', frame: '[[0,0],[600,400]]' };
    current({ window }); const captured = await service.capture();
    current({ windowTitle: 'Documento — salvo', window: { ...window, title: 'Documento — salvo' } });
    await expect(service.replace('Transformado', captured.selectionId)).resolves.toBeUndefined();
  });
  it('diagnostics contain only stage/reason codes, never private text or titles', async () => {
    const diagnostic = vi.fn();
    const service = createSelectedTextService({ clipboard: {}, execute: async () => { throw new Error('TARGET_CHANGED:field sensitive-fixture-content'); }, platform: 'darwin', diagnose: diagnostic });
    await expect(service.capture()).rejects.toThrow('mudou');
    expect(diagnostic).toHaveBeenCalledWith({ stage: 'capture', reason: 'field' });
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('sensitive');
  });
  it('reads Accessibility first, preserving whitespace without touching the clipboard', async () => {
    const { service, clipboard } = setup();
    expect(await service.capture()).toMatchObject({ text: metadata.text, canReplace: true });
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(clipboard.write).not.toHaveBeenCalled();
  });
  it('retains permission errors for a late/lazy renderer instead of an empty window', async () => {
    const { service, execute } = setup({ trusted: false });
    await expect(service.capture()).rejects.toThrow('Acessibilidade');
    expect(service.getSelection()).toMatchObject({ text: '', canReplace: false, error: expect.stringContaining('Acessibilidade') });
    expect(service.getSelection().selectionId).toBeTruthy();
    expect(execute).not.toHaveBeenCalled();
  });
  it('rejects a context-menu capture if another process became focused', async () => {
    const { service, clipboard } = setup();
    await expect(service.capture(100)).rejects.toThrow('mudou');
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });
  it('retains an already generated fallback result without inventing a replacement target or auto action', () => {
    const { service } = setup();
    service.presentResult('Original', 'Gerado', 'A seleção mudou');
    expect(service.getSelection()).toMatchObject({ text: 'Original', result: 'Gerado', canReplace: false, error: 'A seleção mudou' });
    expect(service.getSelection().autoAction).toBeUndefined();
  });
  it('retains a native context action for a late renderer without inventing a replacement target', () => {
    const { service } = setup();
    service.adopt('Texto do menu'); service.setAction('translate');
    expect(service.getSelection()).toMatchObject({ text: 'Texto do menu', autoAction: 'translate', canReplace: false });
  });
  it('uses copy fallback and restores known clipboard formats', async () => {
    const { service, clipboard, clipboardValue } = setup({ text: '' });
    expect((await service.capture()).text).toBe('Copiado da seleção');
    expect(clipboardValue()).toBe('Clipboard anterior');
    expect(clipboard.write).toHaveBeenCalledWith({ text: 'Clipboard anterior', html: '<b>Clipboard anterior</b>', rtf: 'RTF original' });
  });
  it('keeps empty-selection failures available for manual paste', async () => {
    const { service } = setup({ text: '', copiedText: '' });
    await expect(service.capture()).rejects.toThrow('Nenhum texto');
    expect(service.getSelection().error).toContain('Nenhum texto');
  });
  it('distinguishes Automation permission from Accessibility errors', async () => {
    const { service, execute } = setup();
    execute.mockRejectedValue(new Error('Not authorized to send Apple events -1743'));
    await expect(service.capture()).rejects.toThrow('Automação');
    expect(service.getSelection().error).toContain('System Events');
  });
  it.each([{ editable: false }, { bundleId: 'com.apple.Terminal' }])('keeps read-only/terminal selections copy-only: %j', async source => {
    const { service, current } = setup(); current(source);
    const captured = await service.capture();
    expect(captured.text).toBe(metadata.text);
    expect(captured.canReplace).toBe(false);
  });
  it('clears selected text and invalidates pending work when closed', async () => {
    const { service } = setup();
    const captured = await service.capture(); service.clear();
    expect(service.getSelection().text).toBe('');
    expect(service.isCurrent(captured.selectionId)).toBe(false);
  });
  it('cannot replace a truncated selection', async () => {
    const { service } = setup({ text: 'a'.repeat(30001) });
    const capture = await service.capture();
    expect(capture.text).toHaveLength(30000);
    expect(capture.canReplace).toBe(false);
    await expect(service.replace('result', capture.selectionId)).rejects.toThrow('indisponível');
  });
  it('rejects a stale selection id before interacting with another app', async () => {
    const { service, execute } = setup();
    const first = await service.capture();
    await service.capture(); execute.mockClear();
    await expect(service.replace('result', first.selectionId)).rejects.toThrow('expirada');
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([{ pid: 100 }, { windowTitle: 'Outra janela' }, { field: 'other' }, { text: 'Outra seleção' }])('does not paste if the source context changed: %j', async changed => {
    const { service, current, execute } = setup();
    const capture = await service.capture(); current(changed);
    await expect(service.replace('result', capture.selectionId)).rejects.toThrow('mudou');
    expect(execute.mock.calls.some(([, args]) => args[1] === 'paste')).toBe(false);
  });
  it('rechecks selection before pasting and preserves the previous clipboard', async () => {
    const { service, clipboardValue, execute } = setup();
    const capture = await service.capture();
    await service.replace('  Texto transformado\n', capture.selectionId);
    expect(execute.mock.calls.some(([, args]) => args[1] === 'paste')).toBe(true);
    expect(clipboardValue()).toBe('Clipboard anterior');
    await expect(service.replace('again', capture.selectionId)).rejects.toThrow('indisponível');
  });
});
