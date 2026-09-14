#!/usr/bin/env node
/*
 * Native iOS release build on a physical device — `npm run ios:release`.
 *
 * The device name is personal (it embeds the owner's name as shown in
 * Xcode/Finder), so it never goes in the repo: this prompts for it
 * interactively instead of taking it as a committed argument or env var.
 *
 * `expo run:ios` is extremely verbose (raw xcodebuild output), so this
 * wrapper captures it to a temp log file and only prints the tail once the
 * build finishes — the full log stays on disk for `tail -f` / `grep` if you
 * need more context on a failure.
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline/promises');

async function promptDevice() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const device = (await rl.question('Nom de l\'appareil iOS (Xcode > Devices) : ')).trim();
    if (!device) {
      console.error('\n[ios-release] Nom vide, abandon.\n');
      process.exit(1);
    }
    return device;
  } finally {
    rl.close();
  }
}

async function main() {
  const device = await promptDevice();

  const logPath = path.join(os.tmpdir(), 'komfy-ios-build.log');
  const logFd = fs.openSync(logPath, 'w');

  console.log(`\n[ios-release] Building for "${device}" (Release)…`);
  console.log(`[ios-release] Full log: ${logPath}\n`);

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  // CocoaPods crashes (Encoding::CompatibilityError) without a UTF-8 locale.
  const env = { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' };

  // `expo run:ios` skips prebuild when ios/ already exists, so app.json
  // changes (Info.plist keys, plugins) would silently never reach the build.
  console.log('[ios-release] Regenerating ios/ from app.json…');
  const prebuild = spawnSync(npx, ['expo', 'prebuild', '--platform', 'ios', '--clean'], {
    stdio: ['ignore', logFd, logFd],
    env,
  });
  if (prebuild.status !== 0) {
    fs.closeSync(logFd);
    console.log(fs.readFileSync(logPath, 'utf8').split(/\r?\n/).slice(-150).join('\n'));
    process.exit(prebuild.status ?? 1);
  }

  const child = spawn(
    npx,
    // Release embeds the JS bundle, so skip Metro: otherwise the CLI stays
    // attached to the dev server after install and this script never exits.
    ['expo', 'run:ios', '--device', device, '--configuration', 'Release', '--no-bundler'],
    { stdio: ['ignore', logFd, logFd], env },
  );

  child.on('exit', (code) => {
    fs.closeSync(logFd);
    const tail = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).slice(-150).join('\n');
    console.log(tail);
    process.exit(code ?? 1);
  });
}

main();
