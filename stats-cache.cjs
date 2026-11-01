const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

// Only this authenticated ciphertext is persisted by Actions; never save API payloads.
function keyFor(token) {
  return crypto.hkdfSync('sha256', token, 'rintify-profile-cache-v1', 'aggregate-cache', 32);
}
function loadCache(file, token) {
  if (!fs.existsSync(file)) return {};
  try {
    const data = fs.readFileSync(file);
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(token), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    const result = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]));
    if (result.version !== 1) throw Error('Unsupported cache');
    return result.entries;
  } catch {
    console.log('Cache could not be authenticated (or token changed); rebuilding safely.');
    return {};
  }
}
function saveCache(file, token, entries) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(token), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({version: 1, entries})), cipher.final()]);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(`${file}.tmp`, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), {mode: 0o600});
  fs.renameSync(`${file}.tmp`, file);
}
module.exports = {loadCache, saveCache};
