const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const packageName = packageJson.name || 'hades-agent';
const productName = packageJson.build?.productName || 'Hades Agent';
const dryRun = process.argv.includes('--dry-run');

const ownPid = process.pid;

function normalize(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase();
}

function isStaleHadesElectron(command) {
  const normalizedCommand = normalize(command);
  const normalizedRoot = normalize(projectRoot);
  const normalizedPackage = normalize(packageName);
  const normalizedProduct = normalize(productName);

  const looksLikeElectron = [
    'electron.app/contents/macos/electron',
    '/node_modules/electron/',
    '\\node_modules\\electron\\',
    'electron.exe',
    `${normalizedProduct}.app`,
    `${normalizedProduct}.exe`
  ].some(marker => normalizedCommand.includes(normalize(marker)));

  if (!looksLikeElectron) return false;

  return normalizedCommand.includes(normalizedRoot)
    || normalizedCommand.includes(normalizedPackage)
    || normalizedCommand.includes(normalizedProduct);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function killPid(pid, command) {
  if (pid === ownPid) return;

  const preview = command.length > 140 ? `${command.slice(0, 140)}...` : command;

  if (dryRun) {
    console.log(`[dev:clean] would stop Electron pid ${pid}: ${preview}`);
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
    sleep(350);
    if (isAlive(pid)) {
      process.kill(pid, 'SIGKILL');
    }
    console.log(`[dev:clean] stopped Electron pid ${pid}: ${preview}`);
  } catch (error) {
    if (error.code !== 'ESRCH') {
      console.warn(`[dev:clean] could not stop Electron pid ${pid}: ${error.message}`);
    }
  }
}

function cleanUnix() {
  let output = '';

  try {
    output = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' });
  } catch (error) {
    console.warn(`[dev:clean] could not inspect processes: ${error.message}`);
    return;
  }

  const matches = [];

  for (const line of output.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;

    const pid = Number(match[1]);
    const command = match[3];
    if (!Number.isFinite(pid) || pid === ownPid) continue;
    if (!isStaleHadesElectron(command)) continue;

    matches.push({ pid, command });
  }

  if (matches.length === 0) {
    console.log('[dev:clean] no stale Hades Electron process found.');
    return;
  }

  matches.forEach(({ pid, command }) => killPid(pid, command));
}

function cleanWindows() {
  let output = '';

  try {
    output = execFileSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'Get-CimInstance Win32_Process | Where-Object { $_.Name -match "^(electron|Hades Agent)\\.exe$" } | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }'
    ], { encoding: 'utf8' });
  } catch (error) {
    console.warn(`[dev:clean] could not inspect Windows processes: ${error.message}`);
    return;
  }

  const matches = output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [pidText, ...commandParts] = line.split('\t');
      return { pid: Number(pidText), command: commandParts.join('\t') };
    })
    .filter(({ pid, command }) => Number.isFinite(pid) && pid !== ownPid && isStaleHadesElectron(command));

  if (matches.length === 0) {
    console.log('[dev:clean] no stale Hades Electron process found.');
    return;
  }

  for (const { pid, command } of matches) {
    if (dryRun) {
      console.log(`[dev:clean] would stop Electron pid ${pid}: ${command}`);
      continue;
    }

    try {
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      console.log(`[dev:clean] stopped Electron pid ${pid}.`);
    } catch (error) {
      console.warn(`[dev:clean] could not stop Electron pid ${pid}: ${error.message}`);
    }
  }
}

if (process.platform === 'win32') {
  cleanWindows();
} else {
  cleanUnix();
}
