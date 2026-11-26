import { createHash } from 'node:crypto';
import { renameSync, unlinkSync, writeFileSync } from 'node:fs';

export function parseUpdateManifest(text, currentVersion) {
  let manifest;
  try { manifest = JSON.parse(text); } catch (error) { throw new Error(`更新清单不是有效 JSON: ${error.message}`); }
  if (!Number.isInteger(manifest.version) || manifest.version <= 0) throw new Error('更新清单 version 无效');
  if (typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(manifest.sha256)) throw new Error('更新清单 sha256 无效');
  return { version: manifest.version, sha256: manifest.sha256.toLowerCase(), currentVersion };
}

export function swapVerifiedUpdate(bytes, manifest, selfPath) {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== manifest.sha256) throw new Error(`更新包 SHA-256 不匹配: expected=${manifest.sha256} actual=${actual}`);
  const temporary = `${selfPath}.${process.pid}.new`;
  try {
    writeFileSync(temporary, bytes, { mode: 0o600 });
    renameSync(temporary, selfPath);
  } catch (error) {
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
  return { version: manifest.version, sha256: actual };
}
