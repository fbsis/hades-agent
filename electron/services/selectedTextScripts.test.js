import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import scripts from './selectedTextScripts';
import transport from './selectedTextScriptTransport';
function fixture() {
  const state = { front: 99, activations: 0, raised: '', keys: [], delays: 0, settle: 0 };
  const field = { text: 'Original', range: [3, 8] };
  function win(title, identifier, x) {
    return { name: () => title, position: () => [x, 0], size: () => [600, 400], attributes: { byName: name => ({ value: () => name === 'AXIdentifier' ? identifier : null }) }, actions: { byName: () => ({ perform: () => { state.raised = identifier; } }) } };
  }
  const source = win('Editor original', 'source', 100), unrelated = win('Campos #fields', 'fields', 900);
  const focused = { attributes: { byName: name => ({ value: () => ({ AXWindow: source, AXSelectedText: field.text, AXIdentifier: 'body', AXRole: 'AXTextArea', AXSelectedTextRange: field.range })[name], settable: () => true }) } };
  const target = { unixId: () => 99, bundleIdentifier: () => 'com.example.fixture', windows: Object.assign(() => [unrelated, source], { 0: unrelated }), attributes: { byName: name => ({ value: () => name === 'AXFocusedWindow' ? source : focused }) } };
  Object.defineProperty(target, 'frontmost', { set() { state.activations++; if (!state.settle) state.front = 99; } });
  const se = { applicationProcesses: { whose: query => [{ ...target, unixId: query.frontmost ? () => state.front : target.unixId }] }, keystroke: key => state.keys.push(key) };
  // Preserve the target's frontmost setter when looking it up by PID.
  se.applicationProcesses.whose = query => query.frontmost && state.front !== 99 ? [{ unixId: () => state.front }] : [target];
  const env = { Application: () => se, ObjC: { import() {} }, $: { NSEvent: { modifierFlags: 0 } }, delay: () => { state.delays++; if (state.settle && state.delays >= state.settle) state.front = 99; } };
  const run = (script, args) => vm.runInNewContext(`${script}\nrun(${JSON.stringify(args)})`, env);
  const meta = () => JSON.parse(run(scripts.SNAPSHOT_SCRIPT, ['99']));
  return { state, field, run, meta, target, source };
}
describe('source-bound macOS focus restoration', () => {
  it('captures the focused field window, not windows[0]/#fields', () => {
    const f = fixture(); expect(f.meta().window.identifier).toBe('source');
  });
  it('copy never reactivates an app or opens/raises its unrelated window', () => {
    const f = fixture(); f.run(scripts.KEY_SCRIPT, ['99', 'copy', JSON.stringify(f.meta())]);
    expect(f.state.activations).toBe(0); expect(f.state.raised).toBe(''); expect(f.state.keys).toEqual(['c']);
  });
  it('raises exactly the source window and waits for asynchronous activation', () => {
    const f = fixture(), source = f.meta(); f.state.front = 200; f.state.settle = 5;
    expect(f.run(scripts.KEY_SCRIPT, ['99', 'activate', JSON.stringify(source)])).toBe('ok');
    expect(f.state.raised).toBe('source'); expect(f.state.delays).toBe(5); expect(f.state.keys).toEqual([]);
  });
  it('does not select the first window when generic identifiers and bounds are shared', () => {
    const f = fixture(), source = f.meta();
    const wrong = { ...f.source, name: () => 'Another document', actions: { byName: () => ({ perform: () => { f.state.raised = 'WRONG'; } }) } };
    f.target.windows = Object.assign(() => [wrong, f.source], { 0: wrong });
    f.run(scripts.KEY_SCRIPT, ['99', 'activate', JSON.stringify(source)]);
    expect(f.state.raised).toBe('source');
  });
  it('rechecks the freshly observed title immediately before paste', () => {
    const f = fixture(), source = f.meta(); f.source.name = () => 'Another document';
    expect(() => f.run(scripts.KEY_SCRIPT, ['99', 'paste', JSON.stringify(source)])).toThrow('TARGET_CHANGED:window');
    expect(f.state.keys).toEqual([]);
  });
  it('rejects a changed range immediately before paste even when selected text is identical', () => {
    const f = fixture(), source = f.meta(); f.field.range = [30, 8];
    expect(() => f.run(scripts.KEY_SCRIPT, ['99', 'paste', JSON.stringify(source)])).toThrow('TARGET_CHANGED:range');
    expect(f.state.keys).toEqual([]);
  });
  it('rejects changed text immediately before paste without reactivating another app', () => {
    const f = fixture(), source = f.meta(); f.field.text = 'Mudou';
    expect(() => f.run(scripts.KEY_SCRIPT, ['99', 'paste', JSON.stringify(source)])).toThrow('TARGET_CHANGED:text');
    expect(f.state.keys).toEqual([]); expect(f.state.activations).toBe(0);
  });
  it('does not force focus back if the user changed application before copy/paste', () => {
    const f = fixture(), source = f.meta(); f.state.front = 200;
    expect(() => f.run(scripts.KEY_SCRIPT, ['99', 'copy', JSON.stringify(source)])).toThrow('TARGET_CHANGED:process');
    expect(f.state.activations).toBe(0); expect(f.state.keys).toEqual([]);
  });
});
describe('private osascript transport', () => {
  it('keeps selection and metadata out of process arguments and roundtrips via stdin', async () => {
    let argv;
    const selection = 'Fixture \"private\"\n';
    const result = await transport.execute('function run(argv) { return JSON.stringify(argv); }', ['99', 'paste', selection], (_command, args, _options, done) => {
      argv = args;
      return { stdin: { on() {}, end(source) { done(null, vm.runInNewContext(`${source}\nrun()`)); } } };
    });
    expect(argv).toEqual(['-l', 'JavaScript', '-']);
    expect(JSON.parse(result)).toEqual(['99', 'paste', selection]);
  });
});
