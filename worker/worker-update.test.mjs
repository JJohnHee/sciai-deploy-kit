import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseUpdateManifest, swapVerifiedUpdate } from './worker-update.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');

test('parseUpdateManifest requires a positive version and SHA-256', () => {
  assert.throws(() => parseUpdateManifest('not-json', 2));
  assert.throws(() => parseUpdateManifest(JSON.stringify({ version: 3, sha256: 'bad' }), 2), /sha256/);
  assert.deepEqual(parseUpdateManifest(JSON.stringify({ version: 3, sha256: 'A'.repeat(64) }), 2), {
    version: 3, sha256: 'a'.repeat(64), currentVersion: 2
  });
});

test('swapVerifiedUpdate replaces the worker only when the hash matches', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'worker-update-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const worker = path.join(dir, 'sciai-worker.mjs');
  writeFileSync(worker, 'old');
  const bytes = Buffer.from('new');
  const result = swapVerifiedUpdate(bytes, { version: 3, sha256: sha256(bytes) }, worker);
  assert.equal(result.version, 3);
  assert.equal(readFileSync(worker, 'utf8'), 'new');
  assert.equal(existsSync(`${worker}.${process.pid}.new`), false);
});

test('swapVerifiedUpdate preserves the old worker on hash mismatch', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'worker-update-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const worker = path.join(dir, 'sciai-worker.mjs');
  writeFileSync(worker, 'old');
  assert.throws(() => swapVerifiedUpdate(Buffer.from('new'), { version: 3, sha256: '0'.repeat(64) }, worker), /SHA-256/);
  assert.equal(readFileSync(worker, 'utf8'), 'old');
  assert.equal(existsSync(`${worker}.${process.pid}.new`), false);
});
