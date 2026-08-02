#!/usr/bin/env node
/*
 * Cross-OS launcher for the ComfyUI server scripts, so `npm run comfy`
 * works everywhere:
 *   - macOS / Linux -> bash scripts/start-comfy.sh <args>
 *   - Windows       -> pwsh (or powershell) scripts/start-comfy.ps1 <args>
 *
 * The former npm scripts hardcoded `bash …`, which Windows lacks natively.
 * Positional args are forwarded unchanged; the .sh and .ps1 accept the same
 * order (attention backend, then listen mode), e.g. `split`, `sdpa local`.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const args = process.argv.slice(2);
const scriptsDir = __dirname;

/** Runs a command inheriting stdio; exits the process on success, returns the
 *  spawn error otherwise (so the caller can try a fallback). */
function run(cmd, cmdArgs) {
  const res = spawnSync(cmd, cmdArgs, { stdio: 'inherit' });
  if (res.error) return res.error;
  process.exit(res.status ?? 0);
}

if (process.platform === 'win32') {
  const ps1 = path.join(scriptsDir, 'start-comfy.ps1');
  // pwsh (PowerShell 7+, matches the script's shebang) first, then the
  // always-present Windows PowerShell 5.1 as a fallback.
  for (const shell of ['pwsh', 'powershell']) {
    const err = run(shell, ['-ExecutionPolicy', 'Bypass', '-File', ps1, ...args]);
    // run() exits on success; reaching here means it errored.
    if (err.code !== 'ENOENT') {
      console.error(`[comfy] ${shell} failed: ${err.message}`);
      process.exit(1);
    }
    // ENOENT -> this shell isn't installed; try the next one.
  }
  console.error('[comfy] Neither `pwsh` nor `powershell` was found on PATH.');
  process.exit(1);
} else {
  const sh = path.join(scriptsDir, 'start-comfy.sh');
  const err = run('bash', [sh, ...args]);
  console.error(`[comfy] Failed to launch bash: ${err.message}`);
  process.exit(1);
}
