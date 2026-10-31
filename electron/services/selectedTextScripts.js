// Shared JXA helpers. Focused AX window is the source, not windows[0] (which
// can be the Metis floating panel, even after it has been hidden).
const CONTEXT = `
function windowInfo(win) {
  var info = {title:'',identifier:'',frame:''};
  if (!win) return info;
  try { info.title = String(win.name() || ''); } catch (_) {}
  if (!info.title) try { info.title = String(win.attributes.byName('AXTitle').value() || ''); } catch (_) {}
  try { info.identifier = String(win.attributes.byName('AXIdentifier').value() || ''); } catch (_) {}
  try { info.frame = JSON.stringify([win.position(),win.size()]); } catch (_) {}
  return info;
}
function focusedWindow(app, focused) {
  if (!focused) try { focused = app.attributes.byName('AXFocusedUIElement').value(); } catch (_) {}
  if (focused) try { var owner = focused.attributes.byName('AXWindow').value(); if (owner) return owner; } catch (_) {}
  try { var current = app.attributes.byName('AXFocusedWindow').value(); if (current) return current; } catch (_) {}
  try { return app.windows[0]; } catch (_) {}
  return null;
}
function sameWindow(current, expected) {
  if (!current || !expected || (!expected.title && !(expected.identifier && expected.frame))) return false;
  if (expected.frame && current.frame !== expected.frame) return false;
  if (expected.identifier && current.identifier && expected.frame) return current.identifier === expected.identifier;
  return current.title === expected.title && (!expected.identifier || current.identifier === expected.identifier);
}
function context(app) {
  var text = '', field = '', role = '', editable = false, range = '', focused = null;
  try { focused = app.attributes.byName('AXFocusedUIElement').value(); } catch (_) {}
  if (focused) {
    try { text = focused.attributes.byName('AXSelectedText').value() || ''; } catch (_) {}
    try { field = focused.attributes.byName('AXIdentifier').value() || ''; } catch (_) {}
    try { role = focused.attributes.byName('AXRole').value() || ''; } catch (_) {}
    try { editable = focused.attributes.byName('AXSelectedText').settable(); } catch (_) {}
    if (!editable) try { editable = focused.attributes.byName('AXValue').settable(); } catch (_) {}
    try {
      var raw = focused.attributes.byName('AXSelectedTextRange').value();
      if (Array.isArray(raw) && raw.length === 2 && typeof raw[0] === 'number' && typeof raw[1] === 'number') range = JSON.stringify(raw);
      else if (raw && typeof raw.location === 'number' && typeof raw.length === 'number') range = JSON.stringify([raw.location,raw.length]);
    } catch (_) {}
  }
  var win = windowInfo(focusedWindow(app, focused));
  return {pid:app.unixId(),bundleId:app.bundleIdentifier(),windowTitle:win.title,window:win,text:String(text),field:String(field),role:String(role),editable:Boolean(editable),range:range};
}
function matches(current, expected) {
  if (current.pid !== expected.pid || current.bundleId !== expected.bundleId) return 'process';
  if (!sameWindow(current.window, expected.window || {title:expected.windowTitle})) return 'window';
  if (expected.field && current.field !== expected.field) return 'field';
  if (expected.role && current.role !== expected.role) return 'role';
  if (expected.range && current.range !== expected.range) return 'range';
  return '';
}
`;
const SNAPSHOT_SCRIPT = `${CONTEXT}
function run(argv) {
  var se = Application('System Events');
  var app = se.applicationProcesses.whose({frontmost:true})[0];
  if (argv && argv[0] && Number(app.unixId()) !== Number(argv[0])) throw new Error('TARGET_CHANGED:process');
  return JSON.stringify(context(app));
}`;
const KEY_SCRIPT = `${CONTEXT}
ObjC.import('AppKit');
function run(argv) {
  var se = Application('System Events'), pid = Number(argv[0]), action = argv[1];
  var target = se.applicationProcesses.whose({unixId:pid})[0];
  var expected = JSON.parse(argv[2]);
  if (action === 'activate') {
    target.frontmost = true;
    var windows = target.windows(), source = null, candidates = [], exact = [];
    for (var i = 0; i < windows.length; i++) {
      var info = windowInfo(windows[i]);
      if (sameWindow(info, expected.window || {title:expected.windowTitle})) {
        candidates.push(windows[i]);
        if (info.title === expected.windowTitle) exact.push(windows[i]);
      }
    }
    if (exact.length === 1) source = exact[0];
    else if (candidates.length === 1) source = candidates[0];
    if (!source) throw new Error('TARGET_CHANGED:window');
    try { source.actions.byName('AXRaise').perform(); } catch (_) {}
    try { source.attributes.byName('AXMain').value = true; } catch (_) {}
    // macOS activation/Space transitions are asynchronous. Do not assume 150ms.
    for (var attempt = 0; attempt < 40; attempt++) {
      delay(0.05);
      if (Number(se.applicationProcesses.whose({frontmost:true})[0].unixId()) === pid && sameWindow(windowInfo(focusedWindow(target)), expected.window || {title:expected.windowTitle})) return 'ok';
    }
    throw new Error('TARGET_CHANGED:activation');
  }
  var attempts = 0;
  while ((Number($.NSEvent.modifierFlags) & 1966080) !== 0 && attempts++ < 40) delay(0.025);
  if ((Number($.NSEvent.modifierFlags) & 1966080) !== 0) throw new Error('RELEASE_SHORTCUT');
  if (Number(se.applicationProcesses.whose({frontmost:true})[0].unixId()) !== pid) throw new Error('TARGET_CHANGED:process');
  var current = context(target), mismatch = matches(current, expected);
  if (mismatch) throw new Error('TARGET_CHANGED:' + mismatch);
  if (action === 'paste') {
    if (current.windowTitle !== expected.windowTitle) throw new Error('TARGET_CHANGED:window');
    if (!current.editable) throw new Error('TARGET_CHANGED:editable');
    if (current.text && current.text !== expected.text) throw new Error('TARGET_CHANGED:text');
  }
  se.keystroke(action === 'copy' ? 'c' : 'v', {using:['command down']});
  return 'ok';
}`;
module.exports = { SNAPSHOT_SCRIPT, KEY_SCRIPT };
