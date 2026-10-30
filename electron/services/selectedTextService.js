const { clipboard, systemPreferences } = require('electron');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createSelectedTextService } = require('./selectedTextCore');
const exec = promisify(execFile);
module.exports = createSelectedTextService({
  clipboard,
  trusted: () => systemPreferences.isTrustedAccessibilityClient(false),
  execute: async (script, args) => {
    const { stdout } = await exec('osascript', ['-l', 'JavaScript', '-e', script, ...args], { timeout: 6000, maxBuffer: 2 * 1024 * 1024 });
    return stdout.trim();
  }
});
