import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./work-panel.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('./work-panel.js', import.meta.url), 'utf8');

describe('optional integration settings', () => {
  it('keeps native desktop entry points enabled while integration is waiting for a response', async () => {
    const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], { dataset: {} }]));
    const buttons = [...html.matchAll(/<button\b[^>]*id="([^"]+)"[^>]*>/g)].map(match => {
      const node = nodes.get(match[1]);
      if (match[0].includes('data-always-available="1"')) node.dataset.alwaysAvailable = '1';
      return node;
    });
    const command = vi.fn((name) => name === 'config' ? new Promise(() => {}) : Promise.resolve({}));
    vm.runInNewContext(source, {
      window: { metisWork: { command } },
      document: { getElementById: id => nodes.get(id), querySelectorAll: () => buttons }
    });
    expect(nodes.get('loadWorkspaces').disabled).toBe(true);
    for (const [id, panel] of [['openDesktop', 'command'], ['openChat', 'chat'], ['openDesktopSettings', 'settings']]) {
      expect(nodes.get(id).disabled).toBe(false);
      await nodes.get(id).onclick();
      expect(command).toHaveBeenCalledWith('desktop', { panel });
    }
    expect(command.mock.calls.map(call => call[0])).toEqual(['config', 'desktop', 'desktop', 'desktop']);
  });
});
