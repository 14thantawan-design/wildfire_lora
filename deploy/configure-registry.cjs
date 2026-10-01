// Deployment-only: generate the master key on the VM without printing it.
// Never rotate a configured key or copy/modify other production settings.
const fs = require('node:fs');
const crypto = require('node:crypto');
const filename = '/configuration/.env.production';
const fd = fs.openSync(filename, fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW);
try {
  const info = fs.fstatSync(fd);
  if (!info.isFile() || info.nlink !== 1 || info.size > 65536) throw new Error('unsafe configuration file');
  const data = fs.readFileSync(fd, 'utf8');
  const entries = data.split(/\r?\n/).filter((line) => /^\s*(?:export\s+)?DEVICE_REGISTRY_KEY\s*=/.test(line));
  if (entries.length > 1) throw new Error('duplicate registry key; refusing to rotate it');
  if (entries.length) {
    if (!/^\s*(?:export\s+)?DEVICE_REGISTRY_KEY\s*=\s*(?:[0-9a-f]{64}|"[0-9a-f]{64}"|'[0-9a-f]{64}')\s*$/.test(entries[0])) {
      throw new Error('invalid registry key; refusing to rotate it');
    }
  } else {
    fs.appendFileSync(fd, `${data.endsWith('\n') ? '' : '\n'}DEVICE_REGISTRY_KEY=${crypto.randomBytes(32).toString('hex')}\n`);
  }
  fs.fchmodSync(fd, 0o600);
  fs.fsyncSync(fd);
  console.log('Registry master key configured; value not displayed');
} finally { fs.closeSync(fd); }
