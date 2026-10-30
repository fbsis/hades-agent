const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '..');
async function buildHelper(universal = false) {
  if (process.platform !== 'darwin') return;
  await exec('/usr/bin/xcode-select', ['-p'], { timeout: 5000 });
  const output = path.join(root, 'resources/text-actions/metis-text-service');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const targets = universal ? ['arm64', 'x86_64'] : [process.arch === 'arm64' ? 'arm64' : 'x86_64'];
  for (const arch of targets) await exec('/usr/bin/xcrun', ['swiftc', '-O', '-target', `${arch}-apple-macosx14.0`, path.join(root, 'native/text-services/main.swift'), '-o', universal ? `${output}.${arch}` : output], { timeout: 120000 });
  if (universal) {
    await exec('/usr/bin/lipo', ['-create', ...targets.map(arch => `${output}.${arch}`), '-output', output], { timeout: 30000 });
    for (const arch of targets) fs.rmSync(`${output}.${arch}`);
  }
  fs.chmodSync(output, 0o755);
  return output;
}
module.exports = async context => { if (context.electronPlatformName === 'darwin') await buildHelper(true); };
module.exports.buildHelper = buildHelper;
if (require.main === module) buildHelper(process.argv.includes('--universal')).catch(() => { console.error('Falha ao compilar auxiliar de Serviços. No dev, é necessário Xcode Command Line Tools; nenhum download é iniciado pelo Metis.'); process.exitCode = 1; });
