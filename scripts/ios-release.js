#!/usr/bin/env node
/*
 * Native iOS release build on a physical device — `npm run ios:release`.
 *
 * The device name is personal (it embeds the owner's name as shown in
 * Xcode/Finder), so it never goes in the repo: this detects the connected
 * iPhones at run time (`xcrun devicectl`) and asks which one to target,
 * falling back to typing the name when detection finds nothing.
 *
 * `expo run:ios` is extremely verbose (raw xcodebuild output), so this
 * wrapper captures it to a temp log file behind a spinner and prints its tail
 * only on failure; the full log stays on disk for `tail -f` / `grep`.
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Physical iOS devices currently reachable (USB or local network), via the
// CoreDevice CLI shipped with Xcode 15+. Returns [] on any failure so the
// caller can fall back to a manual prompt.
function detectDevices() {
  const jsonPath = path.join(os.tmpdir(), `komfy-devicectl-${process.pid}.json`);
  try {
    const res = spawnSync('xcrun', ['devicectl', 'list', 'devices', '--json-output', jsonPath], {
      stdio: 'ignore',
    });
    if (res.status !== 0) return [];
    const { result } = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return (result?.devices ?? [])
      .filter(
        (d) =>
          d.hardwareProperties?.platform === 'iOS' &&
          d.hardwareProperties?.reality === 'physical' &&
          // Paired but unplugged / off-network devices have no transport.
          d.connectionProperties?.transportType,
      )
      .map((d) => ({
        name: d.deviceProperties?.name ?? d.hardwareProperties.udid,
        udid: d.hardwareProperties.udid,
        transport: d.connectionProperties.transportType === 'wired' ? 'USB' : 'Wi-Fi',
      }));
  } catch {
    return [];
  } finally {
    fs.rmSync(jsonPath, { force: true });
  }
}

const MANUAL = Symbol('manual');

async function promptDevice(p) {
  const s = p.spinner();
  s.start('Recherche des iPhones connectés');
  const devices = detectDevices();
  s.stop(
    devices.length
      ? `${devices.length} iPhone${devices.length > 1 ? 's' : ''} détecté${devices.length > 1 ? 's' : ''}`
      : 'Aucun iPhone connecté détecté',
  );

  let picked = MANUAL;
  if (devices.length) {
    picked = await p.select({
      message: 'Sur quel appareil installer ?',
      options: [
        ...devices.map((d) => ({ value: d, label: d.name, hint: d.transport })),
        { value: MANUAL, label: 'Saisir un nom…', hint: 'appareil non listé' },
      ],
    });
    if (p.isCancel(picked)) abort(p);
  }

  if (picked === MANUAL) {
    const name = await p.text({
      message: 'Nom de l\'appareil iOS (Xcode > Devices)',
      validate: (v) => (v?.trim() ? undefined : 'Nom requis'),
    });
    if (p.isCancel(name)) abort(p);
    return { name: name.trim(), id: name.trim() };
  }
  // The UDID is unambiguous where two devices could share a name.
  return { name: picked.name, id: picked.udid };
}

function abort(p) {
  p.cancel('Abandon.');
  process.exit(1);
}

function run(cmd, args, logFd, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', logFd, logFd], env });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  // @clack/prompts is ESM-only; this script stays CommonJS like its siblings.
  const p = await import('@clack/prompts');

  p.intro('Komfy · build iOS Release');
  const device = await promptDevice(p);

  const logPath = path.join(os.tmpdir(), 'komfy-ios-build.log');
  const logFd = fs.openSync(logPath, 'w');
  p.log.info(`Log complet : ${logPath}`);

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  // CocoaPods crashes (Encoding::CompatibilityError) without a UTF-8 locale.
  const env = { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' };

  const fail = (s, step, code) => {
    s.error(`${step} : échec (code ${code})`);
    fs.closeSync(logFd);
    console.log(fs.readFileSync(logPath, 'utf8').split(/\r?\n/).slice(-150).join('\n'));
    p.outro(`Log complet : ${logPath}`);
    process.exit(code);
  };

  // `expo run:ios` skips prebuild when ios/ already exists, so app.json
  // changes (Info.plist keys, plugins) would silently never reach the build.
  const s = p.spinner({ indicator: 'timer' });
  s.start('Régénération de ios/ depuis app.json');
  const prebuild = await run(npx, ['expo', 'prebuild', '--platform', 'ios', '--clean'], logFd, env);
  if (prebuild !== 0) fail(s, 'Prebuild', prebuild);
  s.stop('ios/ régénéré');

  s.start(`Build Release et installation sur ${device.name}`);
  const build = await run(
    npx,
    // Release embeds the JS bundle, so skip Metro: otherwise the CLI stays
    // attached to the dev server after install and this script never exits.
    ['expo', 'run:ios', '--device', device.id, '--configuration', 'Release', '--no-bundler'],
    logFd,
    env,
  );
  if (build !== 0) fail(s, 'Build', build);
  s.stop(`Installé sur ${device.name}`);

  fs.closeSync(logFd);
  p.outro('Terminé.');
}

main();
