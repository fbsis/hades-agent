const { execFile } = require('node:child_process');
// Selected text and window metadata travel through stdin, never process argv.
function execute(script, args = [], spawn = execFile) {
  const source = `var metisArguments = ${JSON.stringify(args)};\n${script.replace('function run(argv) {', 'function run() { var argv = metisArguments;')}`;
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-'], { timeout: 6000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
    child.stdin.on('error', reject);
    child.stdin.end(source);
  });
}
module.exports = { execute };
