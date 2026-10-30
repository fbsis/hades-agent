const crypto = require('node:crypto');
const WORLD = 1207;
// The bookmark lives in an isolated renderer world, never in the remote page's
// globals. Whole-field integrity data stays there; only the selected text goes to AI.
async function captureBookmark(win, expected) {
  const token = crypto.randomUUID();
  const source = `(() => {
    const expected = ${JSON.stringify(expected)}, token = ${JSON.stringify(token)};
    const node = document.activeElement;
    let bookmark;
    if (node && (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT')) {
      if (node.disabled || node.readOnly || node.type === 'password' || typeof node.selectionStart !== 'number') return false;
      const start = node.selectionStart, end = node.selectionEnd;
      if (end <= start || node.value.slice(start, end) !== expected) return false;
      bookmark = { token, node, start, end, value: node.value, kind: 'input' };
    } else {
      const selection = getSelection();
      if (!selection || selection.rangeCount !== 1 || selection.isCollapsed || selection.toString() !== expected) return false;
      const range = selection.getRangeAt(0);
      const anchor = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
      const owner = anchor?.closest('[contenteditable]');
      if (!owner?.isContentEditable || !owner.contains(range.startContainer) || !owner.contains(range.endContainer)) return false;
      bookmark = { token, node: owner, active: document.activeElement, range: range.cloneRange(), html: owner.innerHTML, kind: 'rich' };
    }
    globalThis.__metisTextBookmark = bookmark;
    return true;
  })()`;
  const captured = await win.webContents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: source }]);
  if (!captured) return null;
  return {
    async replace(text) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return false;
      return win.webContents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(() => {
        const bookmark = globalThis.__metisTextBookmark;
        if (!bookmark || bookmark.token !== ${JSON.stringify(token)} || !bookmark.node.isConnected) return false;
        const node = bookmark.node;
        if (bookmark.kind === 'input') {
          if (document.activeElement !== node || node.disabled || node.readOnly || node.type === 'password' || node.value !== bookmark.value || node.selectionStart !== bookmark.start || node.selectionEnd !== bookmark.end) return false;
          node.focus(); node.setSelectionRange(bookmark.start, bookmark.end);
        } else {
          const selection = getSelection();
          if (document.activeElement !== bookmark.active || !node.isContentEditable || node.innerHTML !== bookmark.html || !selection || selection.rangeCount !== 1) return false;
          const range = selection.getRangeAt(0), original = bookmark.range;
          if (range.startContainer !== original.startContainer || range.startOffset !== original.startOffset || range.endContainer !== original.endContainer || range.endOffset !== original.endOffset) return false;
          node.focus(); selection.removeAllRanges(); selection.addRange(original);
        }
        const applied = document.execCommand('insertText', false, ${JSON.stringify(text)});
        if (applied) delete globalThis.__metisTextBookmark;
        return applied;
      })()` }], true);
    }
  };
}
module.exports = { captureBookmark };
