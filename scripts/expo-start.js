#!/usr/bin/env node
/*
 * Cross-OS replacement for the former POSIX-only npm `start` script:
 *   REACT_NATIVE_PACKAGER_HOSTNAME=$(tailscale ip -4) expo start
 *
 * `VAR=$(...)` is POSIX shell syntax and fails under cmd/PowerShell on Windows.
 * This wrapper resolves the Tailscale IP, exports it, then launches Expo —
 * identically on macOS, Linux and Windows. Any extra CLI args are forwarded.
 *
 * No-Tailscale fallback stays `npm run start:lan` (plain `expo start`).
 */
'use strict';

const { execSync, spawn } = require('node:child_process');

function tailscaleIp() {
  try {
    const out = execSync('tailscale ip -4', { encoding: 'utf8' });
    const ip = out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!ip) throw new Error('empty output');
    return ip;
  } catch (err) {
    console.error(
      '[expo-start] Could not resolve the Tailscale IP via `tailscale ip -4`.'
    );
    console.error(
      '[expo-start] Is Tailscale running? LAN fallback: npm run start:lan'
    );
    process.exit(1);
  }
}

const ip = tailscaleIp();
const env = { ...process.env, REACT_NATIVE_PACKAGER_HOSTNAME: ip };
const args = ['expo', 'start', ...process.argv.slice(2)];
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

console.log(`[expo-start] REACT_NATIVE_PACKAGER_HOSTNAME=${ip}`);

const child = spawn(npx, args, { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error(`[expo-start] Failed to launch Expo: ${err.message}`);
  process.exit(1);
});
