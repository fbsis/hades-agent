const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ACTIONS = new Set(['translate', 'proofread', 'rewrite']);
function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) throw new Error('Diretório de integração não é privado deste usuário.');
  fs.chmodSync(directory, 0o700);
}
function createBridge({ socketPath, token, run, maxActive = 2 }) {
  let server, owned = false, active = 0;
  async function start() {
    if (server) return;
    privateDirectory(path.dirname(socketPath));
    if (fs.existsSync(socketPath)) {
      const stat = fs.lstatSync(socketPath);
      if (!stat.isSocket() || stat.isSymbolicLink()) throw new Error('Caminho de socket inválido.');
      const alive = await new Promise(resolve => {
        const probe = net.createConnection(socketPath);
        probe.once('connect', () => { probe.destroy(); resolve(true); });
        probe.once('error', () => resolve(false));
        probe.setTimeout(1000, () => { probe.destroy(); resolve(true); });
      });
      if (alive) return;
      fs.unlinkSync(socketPath);
    }
    server = net.createServer(socket => {
      let data = Buffer.alloc(0), handled = false;
      const reply = response => { if (!socket.destroyed) socket.end(JSON.stringify(response) + '\n'); };
      socket.setTimeout(90000, () => socket.destroy());
      socket.on('error', () => {});
      socket.on('data', chunk => {
        if (handled) return;
        data = Buffer.concat([data, chunk]);
        if (data.length > 160000) { handled = true; reply({ ok: false }); return; }
        const end = data.indexOf(10);
        if (end < 0) return;
        handled = true;
        void (async () => {
          let claimed = false;
          try {
            const request = JSON.parse(data.subarray(0, end).toString('utf8'));
            data = Buffer.alloc(0);
            const received = Buffer.from(typeof request.token === 'string' ? request.token : '');
            const expected = Buffer.from(token);
            if (request.version !== 1 || received.length !== expected.length || !crypto.timingSafeEqual(received, expected) || !ACTIONS.has(request.action) || typeof request.text !== 'string' || !request.text.trim() || request.text.length > 30000 || active >= maxActive) throw new Error('Request denied');
            active++; claimed = true;
            const text = await run({ action: request.action, text: request.text });
            if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 200000) throw new Error('Invalid result');
            reply({ ok: true, text });
          } catch { reply({ ok: false }); }
          finally { if (claimed) active--; }
        })();
      });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    owned = true; fs.chmodSync(socketPath, 0o600);
  }
  async function stop() {
    if (server) { await new Promise(resolve => server.close(resolve)); server = undefined; }
    if (owned && fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
    owned = false;
  }
  return { start, stop };
}
module.exports = { createBridge, privateDirectory };
