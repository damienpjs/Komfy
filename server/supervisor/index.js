#!/usr/bin/env node
/*
 * Komfy supervisor — a tiny, dependency-free service that owns the ComfyUI
 * process lifecycle so the phone app can turn it on/off remotely and watch
 * its logs live.
 *
 * Why a separate service (not a ComfyUI extension): it must answer WHEN
 * ComfyUI is DOWN, so it cannot live inside ComfyUI's process. It is launched
 * at boot by the OS service manager (see install/) and listens on the
 * Tailscale IP only — same network doctrine as ComfyUI (README §Security).
 *
 * Zero dependencies on purpose: `node index.js` just runs, nothing to install
 * on the server. The WebSocket used for the log stream is hand-rolled for the
 * server→client text direction (the simple one) — see wsSend/wsAccept below.
 *
 * HTTP surface (JSON):
 *   GET  /health        → { supervisor, comfy: "up"|"down"|"starting", pid, since }   (no auth: up/down is harmless)
 *   POST /start         → 202 { starting:true } | 409 { error }                        (auth)
 *   POST /stop          → 200 { stopped:true }  | 409 { error }                        (auth)
 *   GET  /ws?token=…     → WebSocket, replays recent lines then tails live             (auth)
 *
 * Config (env, all optional):
 *   KOMFY_SUPERVISOR_PORT    default 8189
 *   KOMFY_SUPERVISOR_LISTEN  default `tailscale ip -4` (retried until up)
 *   KOMFY_SUPERVISOR_TOKEN   default: read/generate server/supervisor/.token
 *   KOMFY_COMFY_PORT         ComfyUI port to probe/guard, default 8188
 *   KOMFY_COMFY_HOST         ComfyUI host to probe, default = the listen addr
 *                            (ComfyUI listens on the Tailscale IP, NOT 127.0.0.1)
 *   KOMFY_LOG_FILE           default: <BASE_DIR>/logs/comfyui.log
 *   BASE_DIR                 ComfyUI data dir (matches scripts/start-comfy.*)
 *   COMFY_START_ARGS         args forwarded to scripts/comfy.js, e.g. "sdpa"
 */
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync, execSync } = require('node:child_process');

const SUPERVISOR_VERSION = '0.1.0';
const PORT = Number(process.env.KOMFY_SUPERVISOR_PORT) || 8189;
const COMFY_PORT = Number(process.env.KOMFY_COMFY_PORT) || 8188;
const ROOT = path.resolve(__dirname, '..', '..'); // repo root (…/scripts live here)
const BASE_DIR =
  process.env.BASE_DIR || path.join(os.homedir(), 'Documents', 'ComfyUI');
const LOG_FILE =
  process.env.KOMFY_LOG_FILE || path.join(BASE_DIR, 'logs', 'comfyui.log');
const LOG_RING_MAX = 500; // lines replayed to a freshly connected client
const PROBE_TIMEOUT_MS = 4000;

// ── Auth token ─────────────────────────────────────────────────────────────
const TOKEN = resolveToken();

function resolveToken() {
  if (process.env.KOMFY_SUPERVISOR_TOKEN) return process.env.KOMFY_SUPERVISOR_TOKEN;
  const file = path.join(__dirname, '.token');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch {
    /* not created yet */
  }
  const token = crypto.randomBytes(24).toString('hex');
  try {
    fs.writeFileSync(file, token + '\n', { mode: 0o600 });
    log(`generated a new auth token → ${file}`);
  } catch (e) {
    log(`WARN could not persist token (${e.message}); using an ephemeral one`);
  }
  return token;
}

/** Constant-time compare so a wrong token can't be timed byte by byte. */
function tokenOk(candidate) {
  if (typeof candidate !== 'string') return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authorized(req, url) {
  const header = req.headers['authorization'] || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  return tokenOk(bearer) || tokenOk(url.searchParams.get('token'));
}

// ── ComfyUI state ──────────────────────────────────────────────────────────
// `child` is the tracked `node scripts/comfy.js` process (null when we didn't
// launch it — e.g. started by hand via `npm run comfy`). `starting` is a
// short-lived flag between spawn and the first successful /system_stats.
let child = null;
let starting = false;
let startedAt = null;

/** Address ComfyUI listens on = the address we bind to (Tailscale IP), unless
 *  overridden. Resolved lazily so we probe the same interface ComfyUI uses. */
function comfyHost() {
  return process.env.KOMFY_COMFY_HOST || LISTEN_ADDR || '127.0.0.1';
}

/** GET /system_stats with a short timeout → true when ComfyUI answers. */
function probeComfy() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: comfyHost(), port: COMFY_PORT, path: '/system_stats', timeout: PROBE_TIMEOUT_MS },
      (res) => {
        res.resume(); // drain
        resolve(res.statusCode === 200);
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

async function comfyState() {
  if (await probeComfy()) return 'up';
  return starting ? 'starting' : 'down';
}

// ── Log tailing (file → ring buffer → WS clients) ───────────────────────────
const logRing = [];
let logOffset = 0;
let logCarry = ''; // partial trailing line between reads

function pushLogLine(line) {
  const entry = { type: 'log', line, at: Date.now() };
  logRing.push(entry);
  if (logRing.length > LOG_RING_MAX) logRing.shift();
  broadcast(entry);
}

/** Poll the log file: read appended bytes, reset on truncation/rotation. */
function pollLog() {
  fs.stat(LOG_FILE, (err, st) => {
    if (err) return; // no log yet (ComfyUI never started under the tee)
    if (st.size < logOffset) {
      // File shrank → rotated/truncated: this is a new session.
      logOffset = 0;
      logCarry = '';
      logRing.length = 0;
    }
    if (st.size === logOffset) return;
    const stream = fs.createReadStream(LOG_FILE, { start: logOffset, end: st.size - 1 });
    let buf = '';
    stream.on('data', (chunk) => (buf += chunk));
    stream.on('end', () => {
      logOffset = st.size;
      const text = logCarry + buf;
      const lines = text.split('\n');
      logCarry = lines.pop() ?? ''; // last piece may be an unfinished line
      for (const l of lines) pushLogLine(l);
    });
    stream.on('error', () => {});
  });
}

// ── Process control ─────────────────────────────────────────────────────────
async function startComfy() {
  if (await probeComfy()) {
    const err = new Error('ComfyUI already running');
    err.code = 409;
    throw err;
  }
  if (starting) {
    const err = new Error('a start is already in progress');
    err.code = 409;
    throw err;
  }
  starting = true;
  startedAt = Date.now();
  broadcast({ type: 'state', comfy: 'starting', at: startedAt });

  const args = (process.env.COMFY_START_ARGS || '').split(' ').filter(Boolean);
  // Reuse the OS-agnostic dispatcher: node scripts/comfy.js [args].
  // detached: own process group so /stop can signal the whole tree.
  child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'comfy.js'), ...args], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore', // logs go to the tee'd file; we tail that
    env: process.env,
  });
  child.on('exit', (code, signal) => {
    log(`comfy process exited (code=${code} signal=${signal})`);
    child = null;
    starting = false;
    broadcast({ type: 'state', comfy: 'down', code });
  });
  child.on('error', (e) => {
    log(`failed to spawn comfy: ${e.message}`);
    child = null;
    starting = false;
  });

  // Flip starting→up once ComfyUI answers (bounded so a failed boot clears it).
  waitUntilUp(120_000);
}

function waitUntilUp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const tick = async () => {
    if (!starting) return;
    if (await probeComfy()) {
      starting = false;
      broadcast({ type: 'state', comfy: 'up', at: Date.now() });
      return;
    }
    if (Date.now() > deadline) {
      starting = false;
      return;
    }
    setTimeout(tick, 1500);
  };
  setTimeout(tick, 1500);
}

async function stopComfy() {
  if (child && child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM'); // negative pid = the whole group
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
    const ref = child;
    setTimeout(() => {
      if (ref === child && child) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* gone */
        }
      }
    }, 8000);
    return;
  }
  // Not tracked (ComfyUI was started by hand). Best-effort kill by port.
  const pid = pidOnComfyPort();
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
      return;
    } catch (e) {
      const err = new Error(`could not stop PID ${pid}: ${e.message}`);
      err.code = 500;
      throw err;
    }
  }
  const err = new Error('ComfyUI is not running, or was started outside the supervisor and its PID could not be found');
  err.code = 409;
  throw err;
}

/** Best-effort: PID listening on the ComfyUI port (external session). */
function pidOnComfyPort() {
  try {
    if (process.platform === 'win32') {
      const out = execSync(
        `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${COMFY_PORT} -State Listen).OwningProcess"`,
      ).toString();
      const pid = parseInt(out.trim().split(/\s+/)[0], 10);
      return Number.isInteger(pid) ? pid : null;
    }
    const out = execFileSync('lsof', ['-ti', `tcp:${COMFY_PORT}`, '-sTCP:LISTEN']).toString();
    const pid = parseInt(out.trim().split(/\s+/)[0], 10);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null; // lsof missing / nothing listening
  }
}

// ── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, {
      supervisor: SUPERVISOR_VERSION,
      comfy: await comfyState(),
      pid: child?.pid ?? null,
      since: startedAt,
    });
  }

  // Everything below mutates or streams → auth required.
  if (!authorized(req, url)) return json(res, 401, { error: 'unauthorized' });

  if (req.method === 'POST' && url.pathname === '/start') {
    try {
      await startComfy();
      return json(res, 202, { starting: true });
    } catch (e) {
      return json(res, e.code || 500, { error: e.message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/stop') {
    try {
      await stopComfy();
      return json(res, 200, { stopped: true });
    } catch (e) {
      return json(res, e.code || 500, { error: e.message });
    }
  }

  return json(res, 404, { error: 'not found' });
});

// ── WebSocket (hand-rolled, server→client text frames) ───────────────────────
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const wsClients = new Set();

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws' || !authorized(req, url)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.setNoDelay(true);
  wsClients.add(socket);

  // Backfill: current comfy state + recent log lines.
  comfyState().then((comfy) => wsSend(socket, { type: 'state', comfy }));
  for (const entry of logRing) wsSend(socket, entry);

  socket.on('data', (buf) => handleClientFrame(socket, buf));
  socket.on('close', () => wsClients.delete(socket));
  socket.on('error', () => {
    wsClients.delete(socket);
    socket.destroy();
  });
});

/** Minimal inbound frame handling: reply to ping, honor close. We do not read
 *  client text (the app never sends any). */
function handleClientFrame(socket, buf) {
  if (buf.length < 2) return;
  const opcode = buf[0] & 0x0f;
  if (opcode === 0x8) {
    // close
    wsClients.delete(socket);
    try {
      socket.end(Buffer.from([0x88, 0x00]));
    } catch {
      socket.destroy();
    }
  } else if (opcode === 0x9) {
    // ping → pong (echo empty payload)
    try {
      socket.write(Buffer.from([0x8a, 0x00]));
    } catch {
      /* gone */
    }
  }
}

/** Send one text frame (FIN, opcode 0x1, unmasked — server→client). */
function wsSend(socket, obj) {
  const payload = Buffer.from(JSON.stringify(obj));
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  try {
    socket.write(Buffer.concat([header, payload]));
  } catch {
    wsClients.delete(socket);
  }
}

function broadcast(obj) {
  for (const socket of wsClients) wsSend(socket, obj);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function log(msg) {
  console.log(`[komfy-supervisor] ${msg}`);
}

// ── Startup: resolve the listen address (retry until Tailscale is up) ────────
let LISTEN_ADDR = null;

function resolveListen() {
  if (process.env.KOMFY_SUPERVISOR_LISTEN) return process.env.KOMFY_SUPERVISOR_LISTEN;
  try {
    const ip = execFileSync('tailscale', ['ip', '-4']).toString().trim().split('\n')[0];
    return ip || null;
  } catch {
    return null; // Tailscale CLI missing or not up yet
  }
}

function listen() {
  LISTEN_ADDR = resolveListen();
  if (!LISTEN_ADDR) {
    log('Tailscale IP not available yet — retrying bind in 3s…');
    setTimeout(listen, 3000);
    return;
  }
  server.listen(PORT, LISTEN_ADDR, () => {
    log(`listening on http://${LISTEN_ADDR}:${PORT} (comfy on :${COMFY_PORT})`);
    log(`log file: ${LOG_FILE}`);
    setInterval(pollLog, 400);
  });
}

server.on('error', (e) => {
  if (e.code === 'EADDRNOTAVAIL' || e.code === 'EADDRINUSE') {
    log(`bind failed (${e.code}) — retrying in 3s…`);
    setTimeout(() => {
      server.close();
      listen();
    }, 3000);
  } else {
    log(`server error: ${e.message}`);
  }
});

listen();
