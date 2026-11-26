#!/usr/bin/env node
// sciai-worker.mjs — SCAI 设备执行包（与 clawsos daemon 对等实现；依赖随包 node_modules/ws）
// 协议：ClawsOS /device/ws（hello/hello_ack/presence/turn.spawn/turn_stream/turn_exit）
// 必需 env：CLAWSGO_API_URL（如 http://100.94.124.54:8778）、CLAWSGO_DEVICE_TOKEN
// 可选 env：WORKER_NAME（设备名，默认 hostname）、CLAWSGO_WORKSPACE_ROOT（默认 ./workspace）
// 自动更新：每 6h 对照 ${SCIAI_KIT_BASE}/worker-ver.json，校验 version + SHA-256 后原子自替换
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, renameSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import crypto from 'node:crypto';
import WebSocket from 'ws';

// ── 更新校验模块（内联，保证自替换单文件自洽；与 worker-update.mjs 同源）──
function parseUpdateManifest(text, currentVersion) {
  let manifest;
  try { manifest = JSON.parse(text); } catch (error) { throw new Error(`更新清单不是有效 JSON: ${error.message}`); }
  if (!Number.isInteger(manifest.version) || manifest.version <= 0) throw new Error('更新清单 version 无效');
  if (typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(manifest.sha256)) throw new Error('更新清单 sha256 无效');
  return { version: manifest.version, sha256: manifest.sha256.toLowerCase(), currentVersion };
}
function swapVerifiedUpdate(bytes, manifest, selfPath) {
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
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

const WORKER_VERSION = 3;
const KIT_BASE = (process.env.SCIAI_KIT_BASE || 'https://oneyear.tailf48612.ts.net/kit').replace(/\/$/, '');
const SELF_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
// 团队标签（x-team-id）：黑五类组/科研组等分组隔离，派单按 team 路由到对应设备
const TEAM = process.env.SCAI_TEAM || '';

// ── 自动更新（sciai 专属；zcode 节点不走此逻辑，冻结版本） ──
async function checkUpdate(manual) {
  try {
    const manifestResponse = await fetch(KIT_BASE + '/worker-ver.json', { signal: AbortSignal.timeout(15000) });
    if (!manifestResponse.ok) throw new Error(`清单 HTTP ${manifestResponse.status}`);
    const manifest = parseUpdateManifest(await manifestResponse.text(), WORKER_VERSION);
    if (manifest.version > WORKER_VERSION) {
      log(`[update] 服务器有新版 v${manifest.version}（本机 v${WORKER_VERSION}），下载并校验…`);
      const codeResponse = await fetch(KIT_BASE + '/sciai-worker.mjs', { signal: AbortSignal.timeout(60000) });
      if (!codeResponse.ok) throw new Error(`更新包 HTTP ${codeResponse.status}`);
      const bytes = Buffer.from(await codeResponse.arrayBuffer());
      const applied = swapVerifiedUpdate(bytes, manifest, SELF_PATH);
      log(`[update] 已替换为 v${applied.version} sha256=${applied.sha256}，退出重启…`);
      process.exit(0);
    } else if (manual) log(`[update] 已是最新 v${WORKER_VERSION}`);
  } catch (e) {
    log('[update][warn] 更新失败，保留当前版本: ' + e.message);
  }
}

const API = (process.env.CLAWSGO_API_URL || 'http://100.94.124.54:8778').replace(/\/$/, '');
const TOKEN = process.env.CLAWSGO_DEVICE_TOKEN || process.env.CLAWSOS_DEVICE_TOKEN || '';
const NAME = process.env.WORKER_NAME || hostname().toLowerCase();
const WS_ROOT = resolve(process.env.CLAWSGO_WORKSPACE_ROOT || './workspace');
const WS_URL = API.replace(/^http/, 'ws') + '/device/ws?name=' + encodeURIComponent(NAME);
if (!TOKEN) { console.error('[worker] 缺 CLAWSGO_DEVICE_TOKEN'); process.exit(1); }

// instance 持久化（重启不变，服务器按 instance 认设备）
const INST_FILE = join(process.cwd(), '.instance');
let instance;
try { instance = readFileSync(INST_FILE, 'utf-8').trim(); } catch {}
if (!instance) { instance = 'worker-' + crypto.randomUUID(); writeFileSync(INST_FILE, instance); }

function log(...a) { console.log(new Date().toISOString(), ...a); }

// ── turn 执行（对等 clawsos daemon 的 spawnTurn 契约） ──
const turns = new Map(); // turnId -> {sessionId, child}
function gitBash() { if (process.platform !== 'win32') return ''; try { return execSync('where bash', { timeout: 5000 }).toString().trim().split('\n')[0]; } catch { return ''; } }
const BASH = gitBash();
function spawnTurn(params, send) {
  for (const t of turns.values()) if (t.sessionId === params.sessionId) { try { t.child.kill(); } catch {} }
  if (params.ensureCwd) mkdirSync(params.cwd, { recursive: true });
  mkdirSync(WS_ROOT, { recursive: true });
  const turnPath = join(tmpdir(), `clawsgo-turn-${params.turnId}.json`);
  writeFileSync(turnPath, params.turnJson, { mode: 0o600 });
  const child = spawn(process.execPath, ['--input-type=module', '-e', params.loader.replaceAll('__TURN_PATH__', turnPath.replaceAll('\\', '/'))], {
    cwd: WS_ROOT,
    env: {
      ...process.env,
      ...params.env,
      CLAUDE_CONFIG_DIR: join(WS_ROOT, '.claude'),
      ...(process.platform === 'win32' && BASH ? { CLAUDE_CODE_GIT_BASH_PATH: BASH } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  turns.set(params.turnId, { sessionId: params.sessionId, child });
  let buf = '', stderrTail = '';
  child.stdout.on('data', c => { buf += c.toString('utf-8'); const lines = buf.split('\n'); buf = lines.pop() ?? ''; for (const l of lines) if (l.trim()) send({ type: 'turn_stream', turnId: params.turnId, line: l }); });
  child.stderr.on('data', c => { stderrTail = (stderrTail + c.toString('utf-8')).slice(-2000); });
  const fin = code => { turns.delete(params.turnId); try { unlinkSync(turnPath); } catch {} send({ type: 'turn_exit', turnId: params.turnId, code: code ?? 1, stderrTail }); };
  child.on('exit', code => fin(code));
  child.on('error', e => { stderrTail = String(e.message || e); fin(1); });
}

// ── WS 连接（自动重连 + 心跳） ──
let backoff = 1000;
function connect() {
  const ws = new WebSocket(WS_URL, { headers: { authorization: 'Bearer ' + TOKEN, ...(TEAM ? { 'x-team-id': TEAM } : {}) } });
  const send = f => { try { ws.send(JSON.stringify(f)); } catch {} };
  ws.on('open', () => {
    log('[worker] 已连接', WS_URL, 'name=' + NAME, 'instance=' + instance);
    send({ type: 'hello', instance, caps: { tools: true, pty: false, fs: false } });
    backoff = 1000;
  });
  ws.on('message', raw => {
    let f; try { f = JSON.parse(raw.toString()); } catch { return; }
    if (f.type === 'hello_ack') { log('[worker] 已上线（pingMs=' + f.pingMs + '）'); return; }
    if (f.type === 'presence' || f.type === 'ping') return;
    if (f.type === 'rpc' && f.method === 'turn.spawn') {
      log('[worker] 收到 turn', f.params.turnId?.slice(0, 8), 'cwd=' + f.params.cwd);
      try { spawnTurn(f.params, send); send({ type: 'rpc_result', id: f.id, ok: true }); }
      catch (e) { send({ type: 'rpc_result', id: f.id, ok: false, error: String(e.message || e) }); send({ type: 'turn_exit', turnId: f.params.turnId, code: 1, stderrTail: String(e.message || e) }); }
      return;
    }
    if (f.type === 'rpc') { send({ type: 'rpc_result', id: f.id, ok: false, error: 'method not supported: ' + f.method }); return; }
  });
  ws.on('close', () => { log('[worker] 断开，' + backoff + 'ms 后重连'); setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 30000); });
  ws.on('error', () => {});
}
connect();
// ── 自动更新调度：启动 60s 后首查，之后每 6h ──
setTimeout(() => checkUpdate(true), 60000);
setInterval(() => checkUpdate(false), 6 * 3600 * 1000);
process.on('SIGINT', () => { for (const t of turns.values()) { try { t.child.kill(); } catch {} } process.exit(0); });
log('[worker] sciai-worker v' + WORKER_VERSION + ' 启动 name=' + NAME + ' workspace=' + WS_ROOT);
