import { afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import bridgeModule from './textServiceBridge.js';
import workflowModule from './textServiceWorkflow.js';
const directories = [], bridges = [];
const temporary = () => { const dir = fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'metis-service-test-')); directories.push(dir); return dir; };
afterEach(async () => { for (const bridge of bridges.splice(0)) await bridge.stop(); for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
async function exchange(socketPath, request) {
  return new Promise((resolve, reject) => {
    let data = '';
    const socket = net.createConnection(socketPath, () => socket.write(JSON.stringify(request) + '\n'));
    socket.on('data', chunk => { data += chunk; });
    socket.on('end', () => { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } });
    socket.on('error', reject);
  });
}
async function start(run = vi.fn(async ({ text }) => text + ' transformed')) {
  const dir = temporary(), socketPath = path.join(dir, 'bridge.sock'), token = 'test-only-token';
  const bridge = bridgeModule.createBridge({ socketPath, token, run }); bridges.push(bridge);
  await bridge.start();
  return { dir, socketPath, token, run };
}
describe.skipIf(process.platform === 'win32')('private macOS Services bridge', () => {
  it('returns only the requested transformation with no text files or clipboard', async () => {
    const { dir, socketPath, token, run } = await start();
    expect(await exchange(socketPath, { version: 1, token, action: 'translate', text: '  Fixture\n' })).toEqual({ ok: true, text: '  Fixture\n transformed' });
    expect(run).toHaveBeenCalledWith({ action: 'translate', text: '  Fixture\n' });
    expect(fs.readdirSync(dir)).toEqual(['bridge.sock']);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(socketPath).mode & 0o777).toBe(0o600);
  });
  it.each([{ token: 'wrong' }, { action: 'execute' }, { version: 2 }, { text: 'a'.repeat(30001) }])('rejects unauthorized/unsupported requests without invoking AI: %j', async change => {
    const { socketPath, token, run } = await start();
    expect(await exchange(socketPath, { version: 1, token, action: 'translate', text: 'fixture', ...change })).toEqual({ ok: false });
    expect(run).not.toHaveBeenCalled();
  });
  it('does not return provider errors, keys or source contents to system logs', async () => {
    const { socketPath, token } = await start(vi.fn(async () => { throw new Error('secret-test-value'); }));
    expect(await exchange(socketPath, { version: 1, token, action: 'translate', text: 'fixture' })).toEqual({ ok: false });
  });
});
describe('managed Automator workflow installation', () => {
  it('installs three return-text services and updates only its own workflows', () => {
    const dir = temporary();
    const files = workflowModule.installWorkflows(dir, '/fixture/helper', '/fixture/private-config');
    expect(files).toHaveLength(3);
    expect(files.every(workflowModule.isManaged)).toBe(true);
    const metadata = fs.readFileSync(path.join(files[0], 'Contents/Info.plist'), 'utf8');
    expect(metadata).toContain('NSReturnTypes');
    const document = fs.readFileSync(path.join(files[0], 'Contents/document.wflow'), 'utf8');
    expect(document).toContain('exec'); expect(document).not.toContain('OPENAI');
    expect(workflowModule.installWorkflows(dir, '/new/helper', '/new/config')).toEqual(files);
    expect(fs.readdirSync(dir)).toHaveLength(3);
  });
  it('refuses to overwrite another service or a symbolic link', () => {
    const dir = temporary(), target = workflowModule.servicePath(dir, workflowModule.SERVICES[0]);
    fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'user-data'), 'keep');
    expect(() => workflowModule.installWorkflows(dir, '/helper', '/config')).toThrow('não gerenciado');
    expect(fs.readFileSync(path.join(target, 'user-data'), 'utf8')).toBe('keep');
  });
  it('quotes executable/configuration paths, never places selection in shell code', () => {
    expect(workflowModule.shellQuote("a'b")).toBe("'a'\\''b'");
    const generated = workflowModule.workflow(workflowModule.SERVICES[0], '/path with space/helper', '/config&path');
    expect(generated.document).toContain('/config&amp;path');
    expect(generated.document).toContain('/path with space/helper');
    expect(generated.document).not.toContain('selection');
  });
});
