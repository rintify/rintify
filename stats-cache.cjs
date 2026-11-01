const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

// Only this authenticated ciphertext is persisted by Actions; never save API payloads.
function keyFor(secret) {
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/i.test(secret)) {
    throw Error('STATS_CACHE_KEY must be an independent random 32-byte hex key');
  }
  return Buffer.from(secret, 'hex');
}
function loadCache(file, secret) {
  const key = keyFor(secret);
  if (!fs.existsSync(file)) return {};
  try {
    const data = fs.readFileSync(file);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    const result = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]));
    if (result.version !== 2) throw Error('Unsupported cache');
    return result.entries;
  } catch {
    throw Error('Cache authentication failed; remove the damaged or obsolete encrypted cache before retrying.');
  }
}
function saveCache(file, secret, entries) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({version: 2, entries})), cipher.final()]);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(`${file}.tmp`, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), {mode: 0o600});
  fs.renameSync(`${file}.tmp`, file);
}
module.exports = {loadCache, saveCache};
