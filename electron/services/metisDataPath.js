const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let resolvedDataPath;

function getMetisDataPath() {
  if (resolvedDataPath) return resolvedDataPath;

  const target = path.join(os.homedir(), '.Metis');
  const legacy = path.join(os.homedir(), '.Hades');

  try {
    const targetHasData = fs.existsSync(target) && fs.readdirSync(target).length > 0;
    const legacyHasData = fs.existsSync(legacy) && fs.readdirSync(legacy).length > 0;

    fs.mkdirSync(target, { recursive: true });
    if (!targetHasData && legacyHasData) {
      fs.cpSync(legacy, target, { recursive: true, force: false });
    }
  } catch (error) {
    fs.mkdirSync(target, { recursive: true });
    console.warn(`[METIS] Could not migrate legacy agent data: ${error.message}`);
  }

  resolvedDataPath = target;
  return target;
}

module.exports = { getMetisDataPath };
