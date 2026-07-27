#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VERSION = 'v1.9.1';
const MODEL = 'large-v3-turbo-q5_0';
const ROOT = path.resolve(__dirname, '..');
const RESOURCE_ROOT = path.join(ROOT, 'resources', 'whisper');
const MODEL_PATH = path.join(RESOURCE_ROOT, 'models', `ggml-${MODEL}.bin`);
const VAD_MODEL = 'silero-v6.2.0';
const VAD_MODEL_PATH = path.join(RESOURCE_ROOT, 'models', `ggml-${VAD_MODEL}.bin`);
const MIN_MODEL_BYTES = 500 * 1024 * 1024;
const MIN_VAD_MODEL_BYTES = 800 * 1024;

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const platform = argument('platform', process.platform);
const arch = argument('arch', process.arch);
const runtimeDir = path.join(RESOURCE_ROOT, 'bin', `${platform}-${arch}`);
const executableName = platform === 'win32' ? 'whisper-server.exe' : 'whisper-server';
const executablePath = path.join(runtimeDir, executableName);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    stdio: 'inherit',
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function download(url, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const partial = `${destination}.part`;
  run('curl', ['--fail', '--location', '--retry', '3', '--output', partial, url]);
  fs.renameSync(partial, destination);
}

function prepareModel() {
  const modelsDir = path.dirname(MODEL_PATH);
  if (fs.existsSync(MODEL_PATH) && fs.statSync(MODEL_PATH).size >= MIN_MODEL_BYTES) {
    console.log(`[whisper] Model already available: ${MODEL_PATH}`);
  } else {
    console.log(`[whisper] Downloading multilingual ${MODEL} model...`);
    download(
      `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL}.bin`,
      MODEL_PATH
    );
  }

  if (
    fs.existsSync(VAD_MODEL_PATH)
    && fs.statSync(VAD_MODEL_PATH).size >= MIN_VAD_MODEL_BYTES
  ) {
    console.log(`[whisper] VAD model already available: ${VAD_MODEL_PATH}`);
  } else {
    console.log(`[whisper] Downloading ${VAD_MODEL} voice activity model...`);
    download(
      `https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-${VAD_MODEL}.bin`,
      VAD_MODEL_PATH
    );
  }

  const retainedModels = new Set([MODEL_PATH, VAD_MODEL_PATH]);
  for (const name of fs.readdirSync(modelsDir)) {
    const candidate = path.join(modelsDir, name);
    if (!retainedModels.has(candidate) && /^ggml-.*\.bin$/.test(name)) {
      fs.unlinkSync(candidate);
      console.log(`[whisper] Removed obsolete model: ${name}`);
    }
  }
}

function prepareWindows() {
  if (arch !== 'x64') {
    throw new Error(`Windows ${arch} is not supported by the official whisper.cpp release.`);
  }
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hades-whisper-win-'));
  const archive = path.join(workDir, 'whisper.zip');
  download(
    `https://github.com/ggml-org/whisper.cpp/releases/download/${VERSION}/whisper-bin-x64.zip`,
    archive
  );
  if (process.platform === 'win32') {
    run('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${workDir.replaceAll("'", "''")}' -Force`
    ]);
  } else {
    run('unzip', ['-q', archive, '-d', workDir]);
  }
  const releaseDir = path.join(workDir, 'Release');
  fs.mkdirSync(runtimeDir, { recursive: true });
  for (const name of fs.readdirSync(releaseDir)) {
    if (
      name === 'whisper-server.exe'
      || name === 'whisper.dll'
      || name === 'ggml.dll'
      || name === 'ggml-base.dll'
      || name.startsWith('ggml-cpu-')
    ) {
      fs.copyFileSync(path.join(releaseDir, name), path.join(runtimeDir, name));
    }
  }
}

function prepareMac() {
  if (!['arm64', 'x64'].includes(arch)) {
    throw new Error(`macOS ${arch} is not supported.`);
  }
  if (arch !== process.arch) {
    throw new Error(`Cross-compiling whisper.cpp from ${process.arch} to ${arch} is not supported.`);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hades-whisper-mac-'));
  const archive = path.join(workDir, 'source.tar.gz');
  download(
    `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${VERSION}.tar.gz`,
    archive
  );
  run('tar', ['-xzf', archive, '-C', workDir]);
  const sourceDir = path.join(workDir, `whisper.cpp-${VERSION.slice(1)}`);
  const buildDir = path.join(sourceDir, 'build');
  run('cmake', [
    '-S', sourceDir,
    '-B', buildDir,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DBUILD_SHARED_LIBS=OFF',
    '-DWHISPER_BUILD_TESTS=OFF',
    '-DWHISPER_BUILD_EXAMPLES=ON',
    '-DWHISPER_BUILD_SERVER=ON'
  ]);
  run('cmake', ['--build', buildDir, '--config', 'Release', '--target', 'whisper-server', '-j']);

  const builtPath = path.join(buildDir, 'bin', executableName);
  if (!fs.existsSync(builtPath)) throw new Error(`Built server not found at ${builtPath}`);
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.copyFileSync(builtPath, executablePath);
  fs.chmodSync(executablePath, 0o755);
}

function prepareRuntime() {
  if (fs.existsSync(executablePath)) {
    console.log(`[whisper] Runtime already available: ${executablePath}`);
    return;
  }
  console.log(`[whisper] Preparing ${VERSION} runtime for ${platform}-${arch}...`);
  if (platform === 'darwin') return prepareMac();
  if (platform === 'win32') return prepareWindows();
  throw new Error(`Local Whisper packaging is not configured for ${platform}-${arch}.`);
}

prepareModel();
prepareRuntime();
console.log('[whisper] Local transcription resources are ready.');
