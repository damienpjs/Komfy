#!/usr/bin/env node
/*
 * Komfy pairing helper — `npm run pair`.
 *
 * Prints a pairing code the phone can scan in the setup wizard, so the user
 * never has to type the Tailscale URL or the supervisor token by hand. The
 * code is a `komfy://setup` deep link carrying three values:
 *   u = ComfyUI server URL   (http://<tailscale-ip>:<comfy-port>)
 *   s = supervisor URL       (http://<tailscale-ip>:<supervisor-port>)
 *   t = supervisor auth token
 *
 * Output:
 *   1. a scannable QR (if `qrcode-terminal` is installed — it is a devDep);
 *   2. the deep link in clear text (copy/paste fallback → "Paste code" in the
 *      wizard). Everything degrades gracefully with zero dependencies.
 *
 * Config (env, all optional): KOMFY_TAILSCALE_IP, KOMFY_COMFY_PORT (8188),
 * KOMFY_SUPERVISOR_PORT (8189), KOMFY_SUPERVISOR_TOKEN (else read
 * server/supervisor/.token).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const COMFY_PORT = Number(process.env.KOMFY_COMFY_PORT) || 8188;
const SUPERVISOR_PORT = Number(process.env.KOMFY_SUPERVISOR_PORT) || 8189;

function fail(msg) {
  console.error(`\n[pair] ${msg}\n`);
  process.exit(1);
}

function tailscaleIp() {
  if (process.env.KOMFY_TAILSCALE_IP) return process.env.KOMFY_TAILSCALE_IP;
  try {
    return execFileSync('tailscale', ['ip', '-4']).toString().trim().split('\n')[0];
  } catch {
    fail(
      'Could not run `tailscale ip -4`. Start Tailscale, or set KOMFY_TAILSCALE_IP=100.x.y.z',
    );
  }
}

function token() {
  if (process.env.KOMFY_SUPERVISOR_TOKEN) return process.env.KOMFY_SUPERVISOR_TOKEN;
  const file = path.join(__dirname, '..', 'server', 'supervisor', '.token');
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (t) return t;
  } catch {
    /* not generated yet */
  }
  fail(
    'No supervisor token found. Start the supervisor once (`npm run supervisor`) to\n' +
      '       generate server/supervisor/.token, or set KOMFY_SUPERVISOR_TOKEN.',
  );
}

const ip = tailscaleIp();
const serverUrl = `http://${ip}:${COMFY_PORT}`;
const supervisorUrl = `http://${ip}:${SUPERVISOR_PORT}`;
const tok = token();

const deepLink =
  'komfy://setup?' +
  `u=${encodeURIComponent(serverUrl)}` +
  `&s=${encodeURIComponent(supervisorUrl)}` +
  `&t=${encodeURIComponent(tok)}`;

console.log('\n  Komfy — pairing code\n  ────────────────────');
console.log(`  ComfyUI     ${serverUrl}`);
console.log(`  Supervisor  ${supervisorUrl}`);
console.log(`  Token       ${tok.slice(0, 6)}… (${tok.length} chars)\n`);

try {
  // Optional: a scannable QR in the terminal.
  const qrcode = require('qrcode-terminal');
  qrcode.generate(deepLink, { small: true }, (qr) => {
    console.log(qr);
    printLink();
  });
} catch {
  console.log('  (install qrcode-terminal for a scannable QR: npm install)\n');
  printLink();
}

function printLink() {
  console.log('  Scan the QR in the Komfy setup wizard, or paste this code:\n');
  console.log(`  ${deepLink}\n`);
  console.log('  ⚠  This code contains the supervisor token — share it only over a');
  console.log('     trusted channel (it grants remote start/stop of ComfyUI).\n');
}
