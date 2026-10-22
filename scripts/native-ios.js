#!/usr/bin/env node
/*
 * Builds Komfy natively for the iPhone and runs it there: `npm run native`.
 *
 * The chain `expo run:ios` runs, spelt out so that each step can say what
 * went wrong: Expo generates ios/ from app.json, CocoaPods installs the native
 * modules, xcodebuild compiles and signs the app for the chosen iPhone,
 * devicectl installs and launches it, over Wi-Fi once the iPhone has been
 * paired by cable.
 *
 * Everything a build needs is checked first, and when something is missing
 * the run stops there with the list of what to fix, rather than failing five
 * minutes in on a signing error. `--check` runs that list alone.
 *
 *   npm run native [-- --mode release|debug] [--device NAME|UDID] [--team ID] [--clean]
 *   npm run native:check
 *
 * Release is the default: it embeds the JS bundle, so the app runs without
 * Metro, which is what a standalone install is for. Debug loads the JS from
 * Metro (`npm start`). ios/ is only regenerated when what it is generated
 * from changed (app.json, the files it points at, plugins/, package.json and
 * the lockfile), so an unchanged project rebuilds incrementally; --clean
 * forces it. Logs of every step land in .expo/native-ios/.
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, styleText } = require('node:util');

const ROOT = path.resolve(__dirname, '..');
const IOS_DIR = path.join(ROOT, 'ios');
// Same place `expo run:ios` builds into, so either command reuses the other's
// compiled pods. It goes with ios/ when ios/ is regenerated.
const DERIVED_DATA = path.join(IOS_DIR, 'build');
// .expo/ is git-ignored and already holds this checkout's local state.
const STATE_DIR = path.join(ROOT, '.expo', 'native-ios');
const LOG_DIR = path.join(STATE_DIR, 'logs');
const TEAM_FILE = path.join(STATE_DIR, 'team');
// Written into ios/ itself, so it disappears with the folder it describes.
const PREBUILD_STAMP = path.join(IOS_DIR, '.komfy-prebuild');
const BUNDLE_ID_PATTERN = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const PERCENT = /(\d{1,3})\s?%/;
// CocoaPods crashes (Encoding::CompatibilityError) without a UTF-8 locale.
const ENV = { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' };

const color = (style, text) => styleText(style, text);
const OK = 'ok';
const WARN = 'warn';
const FAIL = 'fail';
const MARKS = { [OK]: color('green', '✓'), [WARN]: color('yellow', '!'), [FAIL]: color('red', '✗') };

let p; // @clack/prompts, ESM-only: imported in main().

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60_000, ...options });
  return {
    status: result.error ? 127 : result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

const check = (name, status, detail = '', fix = []) => ({ name, status, detail, fix });

// --- Preflight ---------------------------------------------------------------

function checkProject(ctx) {
  const checks = [];
  if (fs.existsSync(path.join(ROOT, 'node_modules', 'expo', 'bin', 'cli'))) {
    checks.push(check('Dependencies', OK, 'node_modules installed'));
  } else {
    checks.push(check('Dependencies', FAIL, 'node_modules/expo is missing', ['npm install']));
  }

  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo ?? {};
  } catch (error) {
    checks.push(check('app.json', FAIL, `unreadable: ${error.message}`));
    return checks;
  }
  const bundle = config.ios?.bundleIdentifier ?? '';
  ctx.bundle = bundle;
  if (BUNDLE_ID_PATTERN.test(bundle)) {
    checks.push(check('Bundle identifier', OK, bundle));
  } else {
    checks.push(
      check('Bundle identifier', FAIL, bundle ? `"${bundle}" is not a bundle identifier` : 'empty', [
        'Set expo.ios.bundleIdentifier in app.json, e.g. com.yourname.komfy',
        '(letters, digits, dots and hyphens).',
      ]),
    );
  }
  return checks;
}

function checkXcode() {
  const selected = run('xcode-select', ['-p']).stdout.trim();
  if (!selected.includes('.app/Contents/Developer')) {
    return [
      check('Xcode', FAIL, `xcode-select points at ${selected || 'nothing'}`, [
        'Install Xcode from the App Store, then select it:',
        '  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer',
      ]),
    ];
  }
  const checks = [];
  const version = run('xcodebuild', ['-version']).stdout.split(/\s+/).slice(0, 2).join(' ');
  checks.push(check('Xcode', OK, version));

  if (run('xcodebuild', ['-license', 'check']).status === 0) {
    checks.push(check('Xcode licence', OK, 'accepted'));
  } else {
    checks.push(check('Xcode licence', FAIL, 'not accepted', ['sudo xcodebuild -license accept']));
  }

  const sdk = run('xcodebuild', ['-showsdks']).stdout.match(/-sdk (iphoneos[\d.]+)/);
  if (sdk) {
    checks.push(check('iOS SDK', OK, sdk[1]));
  } else {
    checks.push(
      check('iOS SDK', FAIL, 'the iOS platform is not installed', [
        'Xcode → Settings → Components → iOS → Get.',
      ]),
    );
  }

  const pod = run('pod', ['--version'], { env: ENV });
  if (pod.status === 0) {
    checks.push(check('CocoaPods', OK, pod.stdout.trim()));
  } else {
    checks.push(check('CocoaPods', FAIL, 'pod not found', ['brew install cocoapods']));
  }
  return checks;
}

// The teams of every account signed into Xcode, or null when unreadable.
// Read as XML: Xcode's preferences hold data blobs that plutil cannot turn
// into JSON, and this subtree is only strings and booleans anyway.
function xcodeTeams() {
  const file = path.join(os.tmpdir(), `komfy-xcode-prefs-${process.pid}.plist`);
  try {
    if (run('defaults', ['export', 'com.apple.dt.Xcode', file]).status !== 0) return null;
    // The second key is where Xcode kept them before version 15.
    const xml = ['IDEProvisioningTeamByIdentifier', 'IDEProvisioningTeams']
      .map((key) => run('plutil', ['-extract', key, 'xml1', '-o', '-', file]))
      .find((result) => result.status === 0);
    if (!xml) return null;
    const teams = [];
    for (const [, body] of xml.stdout.matchAll(/<dict>((?:(?!<dict>)[\s\S])*?)<\/dict>/g)) {
      const value = (key) => body.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1];
      const id = value('teamID');
      if (!id || teams.some((t) => t.id === id)) continue;
      teams.push({
        id,
        name: value('teamName') ?? id,
        free: /<key>isFreeProvisioningTeam<\/key>\s*<true\/>/.test(body),
      });
    }
    return teams;
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function readRememberedTeam() {
  try {
    return fs.readFileSync(TEAM_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

function checkSigning(ctx) {
  const checks = [];
  const identities = run('security', ['find-identity', '-v', '-p', 'codesigning']).stdout;
  const development = identities.split('\n').find((line) => line.includes('Apple Development'));
  if (development) {
    checks.push(check('Signing certificate', OK, development.match(/"(.+)"/)?.[1] ?? 'found'));
  } else {
    checks.push(
      check('Signing certificate', WARN, 'no Apple Development certificate in the keychain', [
        'Xcode creates one on the first signed build. If it does not:',
        '  Xcode → Settings → Accounts → your team → Manage Certificates → + → Apple Development.',
      ]),
    );
  }

  const teams = ctx.teams;
  if (teams === null) {
    checks.push(check('Xcode account', WARN, "could not read Xcode's accounts"));
    checks.push(
      ctx.team
        ? check('Team', OK, ctx.team)
        : check('Team', FAIL, 'no team named', [
            'Pass the team ID shown in Xcode → Settings → Accounts:',
            '  npm run native -- --team <ID>',
          ]),
    );
    return checks;
  }
  if (!teams.length) {
    checks.push(
      check('Xcode account', FAIL, 'no Apple account signed into Xcode', [
        'Xcode → Settings → Accounts → + → Apple ID. A free Apple ID is enough',
        '(its "Personal Team" signs for your own iPhone, 7 days at a time).',
      ]),
    );
    return checks;
  }
  const listed = teams.map((t) => `${t.name} (${t.id})`).join(', ');
  checks.push(check('Xcode account', OK, listed));

  const match = teams.find((t) => t.id === ctx.team);
  if (!ctx.team) {
    checks.push(
      check('Team', FAIL, `${teams.length} teams in Xcode, none chosen`, [
        `Pass one: npm run native -- --team <ID>   (${listed})`,
      ]),
    );
  } else if (!match) {
    checks.push(
      check('Team', FAIL, `team ${ctx.team} is not held by any Xcode account`, [
        `Use one of: ${listed}.`,
        `(--team, APPLE_TEAM_ID or ${path.relative(ROOT, TEAM_FILE)} named it.)`,
      ]),
    );
  } else if (match.free) {
    ctx.freeTeam = true;
    checks.push(
      check(
        'Team',
        WARN,
        `${match.name} is a free team: the app stops opening after 7 days, run npm run native again`,
      ),
    );
  } else {
    checks.push(check('Team', OK, match.name));
  }
  return checks;
}

function listDevices() {
  const file = path.join(os.tmpdir(), `komfy-devicectl-${process.pid}.json`);
  try {
    const result = run('xcrun', ['devicectl', 'list', 'devices', '--json-output', file]);
    if (result.status !== 0 || !fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8') || '{}').result?.devices ?? [];
  } catch {
    return null;
  } finally {
    fs.rmSync(file, { force: true });
  }
}

const deviceName = (d) => d?.deviceProperties?.name ?? 'iPhone';
const isPaired = (d) => d.connectionProperties?.pairingState === 'paired';
// A paired iPhone that is off, asleep elsewhere or off the network has no transport.
const isReachable = (d) => Boolean(d.connectionProperties?.transportType);

function phones(devices, wanted) {
  let found = devices.filter(
    (d) => d.hardwareProperties?.platform === 'iOS' && d.hardwareProperties?.reality === 'physical',
  );
  if (wanted) {
    const needle = wanted.toLowerCase();
    found = found.filter(
      (d) =>
        deviceName(d).toLowerCase().includes(needle) ||
        [d.identifier, d.hardwareProperties?.udid].includes(wanted),
    );
  }
  return found;
}

function checkDevice(ctx) {
  if (ctx.devices === null) {
    return [
      check('iPhone', FAIL, 'devicectl could not list devices', [
        'xcrun devicectl list devices  (to see the error)',
      ]),
    ];
  }
  const found = phones(ctx.devices, ctx.wantedDevice);
  if (!found.length) {
    return [
      check(
        'iPhone',
        FAIL,
        ctx.wantedDevice ? `no iPhone matches "${ctx.wantedDevice}"` : 'no iPhone known to this Mac',
        [
          'Plug the iPhone in by cable once, unlock it and tap Trust.',
          'After that first pairing it is reachable over Wi-Fi too.',
          'xcrun devicectl list devices  shows what the Mac sees.',
        ],
      ),
    ];
  }
  const device =
    ctx.device ?? found.find((d) => isPaired(d) && isReachable(d)) ?? found.find(isPaired) ?? found[0];
  ctx.device = device;
  const name = deviceName(device);
  if (!isPaired(device)) {
    return [
      check('iPhone', FAIL, `${name} is not paired`, [
        'Plug it in by cable, unlock it and tap Trust when it asks.',
      ]),
    ];
  }
  if (!isReachable(device)) {
    return [
      check('iPhone', FAIL, `${name} is paired but not reachable right now`, [
        'Unlock it and keep it on the same Wi-Fi as the Mac, or plug it in by cable.',
      ]),
    ];
  }
  const checks = [];
  const model = device.hardwareProperties?.marketingName ?? '';
  const osVersion = device.deviceProperties?.osVersionNumber ?? '';
  const via = { wired: 'cable', localNetwork: 'Wi-Fi' }[device.connectionProperties.transportType] ?? 'unknown link';
  checks.push(check('iPhone', OK, `${name}, ${model}, iOS ${osVersion}, over ${via}`));

  const mode = device.deviceProperties?.developerModeStatus;
  if (mode === 'enabled') {
    checks.push(check('Developer Mode', OK, 'enabled'));
  } else {
    checks.push(
      check('Developer Mode', FAIL, String(mode ?? 'unknown'), [
        'On the iPhone: Settings → Privacy & Security → Developer Mode → On.',
        'It restarts, then asks once more to confirm.',
      ]),
    );
  }
  return checks;
}

// Asks only what cannot be decided alone: which team when Xcode holds several
// and none was named, which iPhone when several are reachable. Never in
// --check, never without a terminal: there the preflight reports it instead.
async function choose(ctx, interactive) {
  const teams = ctx.teams ?? [];
  if (!ctx.team && teams.length === 1) ctx.team = teams[0].id;
  if (!ctx.team && teams.length > 1 && interactive) {
    const picked = await p.select({
      message: 'Which team signs the app?',
      options: teams.map((t) => ({ value: t.id, label: t.name, hint: t.free ? `${t.id}, free` : t.id })),
    });
    if (p.isCancel(picked)) abort();
    ctx.team = picked;
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(TEAM_FILE, `${picked}\n`);
    p.log.info(`Remembered in ${path.relative(ROOT, TEAM_FILE)}.`);
  }

  if (ctx.devices && !ctx.wantedDevice && interactive) {
    const ready = phones(ctx.devices).filter((d) => isPaired(d) && isReachable(d));
    if (ready.length > 1) {
      const picked = await p.select({
        message: 'Which iPhone?',
        options: ready.map((d) => ({
          value: d,
          label: deviceName(d),
          hint: d.connectionProperties.transportType === 'wired' ? 'cable' : 'Wi-Fi',
        })),
      });
      if (p.isCancel(picked)) abort();
      ctx.device = picked;
    }
  }
}

async function preflight(ctx, interactive) {
  const s = p.spinner();
  s.start('Checking the toolchain, the project and the iPhone');
  ctx.teams = xcodeTeams();
  ctx.devices = listDevices();
  s.stop('Checked the toolchain, the project and the iPhone');

  await choose(ctx, interactive);

  const checks = [
    ...checkProject(ctx),
    ...checkXcode(),
    ...checkSigning(ctx),
    ...checkDevice(ctx),
  ];
  const width = Math.max(...checks.map((c) => c.name.length));
  p.log.message(
    checks
      .map((c) => `${MARKS[c.status]}  ${color('bold', c.name.padEnd(width))}  ${color('dim', c.detail)}`)
      .join('\n'),
  );

  const blocking = checks.filter((c) => c.status === FAIL);
  const advice = checks.filter((c) => c.fix.length && c.status !== OK);
  if (advice.length) {
    const body = advice
      .map((c, i) => {
        const tint = c.status === FAIL ? 'red' : 'yellow';
        return [
          `${color('bold', color(tint, `${i + 1}. ${c.name}`))}  ${color('dim', c.detail)}`,
          ...c.fix.map((line) => `   ${line}`),
        ].join('\n');
      })
      .join('\n\n');
    p.box(body, blocking.length ? 'What is missing' : 'Worth knowing', {
      formatBorder: (text) => color(blocking.length ? 'red' : 'yellow', text),
    });
  }
  return blocking.length === 0;
}

// --- Prebuild state ----------------------------------------------------------

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
}

// What `expo prebuild` reads: app.json and every file it points at (icons,
// splash), the config plugins, and the dependencies, whose native modules
// autolinking adds. When none of it changed, ios/ is still what prebuild
// would write, and keeping it keeps the incremental build.
function prebuildHash() {
  const appJson = path.join(ROOT, 'app.json');
  const referenced = [];
  const walk = (value) => {
    if (typeof value === 'string' && value.startsWith('./')) {
      const file = path.join(ROOT, value);
      for (const candidate of [file, `${file}.js`]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) referenced.push(candidate);
      }
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(walk);
    }
  };
  walk(JSON.parse(fs.readFileSync(appJson, 'utf8')));
  const files = [
    appJson,
    path.join(ROOT, 'package.json'),
    path.join(ROOT, 'package-lock.json'),
    ...referenced,
    ...filesUnder(path.join(ROOT, 'plugins')),
  ];
  const hash = crypto.createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    if (!fs.existsSync(file)) continue;
    hash.update(path.relative(ROOT, file)).update('\0').update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

// Prebuild names the Xcode project after app.json's name, sanitised. The
// .xcworkspace next to it only appears once CocoaPods has run.
function projectName() {
  const project = fs.existsSync(IOS_DIR)
    ? fs.readdirSync(IOS_DIR).find((name) => name.endsWith('.xcodeproj'))
    : undefined;
  return project?.replace(/\.xcodeproj$/, '');
}

function prebuildReason(clean, hash) {
  if (clean) return '--clean';
  if (!projectName()) return 'no ios/ project yet';
  let stamp = '';
  try {
    stamp = fs.readFileSync(PREBUILD_STAMP, 'utf8').trim();
  } catch {
    return 'ios/ was not generated by npm run native';
  }
  return stamp === hash ? '' : 'app.json, plugins/ or dependencies changed';
}

function podsInSync() {
  try {
    return (
      fs.readFileSync(path.join(IOS_DIR, 'Podfile.lock'), 'utf8') ===
      fs.readFileSync(path.join(IOS_DIR, 'Pods', 'Manifest.lock'), 'utf8')
    );
  } catch {
    return false;
  }
}

// --- Build steps -------------------------------------------------------------

// Known failures, most specific first: a pattern on the step's output and
// what to do about it.
const HINTS = [
  [
    /maximum number of apps for free development|reached the maximum number of/,
    [
      'A free team runs 3 apps on a device at once and registers 10 bundle IDs a week.',
      'Delete another sideloaded app from the iPhone, or reuse a bundle identifier.',
    ],
  ],
  [
    /Failed Registering Bundle Identifier|is not available\. Please enter a different string/,
    ['Somebody already owns this bundle identifier at Apple: change expo.ios.bundleIdentifier.'],
  ],
  [
    /Unable to find a destination matching|Unable to find a device matching|specified device was not found/,
    ['Xcode cannot reach the iPhone: unlock it and keep it on the same Wi-Fi as the Mac,', 'or plug it in by cable.'],
  ],
  [/device is locked|passcode/i, ['Unlock the iPhone and run npm run native again.']],
  [
    /profile has not been explicitly trusted|untrusted developer|invalid code signature/i,
    [
      'The iPhone does not trust your developer certificate yet. On the iPhone:',
      '  Settings → General → VPN & Device Management → your Apple ID → Trust.',
      'Then run npm run native again.',
    ],
  ],
  [/developer mode/i, ['On the iPhone: Settings → Privacy & Security → Developer Mode → On.']],
  [
    /No Accounts|No account for team|Signing for .* requires a development team/,
    ["Sign into Xcode with the team's Apple ID: Xcode → Settings → Accounts → +."],
  ],
  [
    /requires a provisioning profile with the Push Notifications feature|aps-environment/,
    [
      'A free team cannot sign the Push Notifications capability.',
      'plugins/withoutPushEntitlement.js removes it: check app.json still lists it.',
    ],
  ],
  [
    /No profiles for '[^']+' were found|Provisioning profile .* doesn't include/,
    [
      'Xcode could not make a provisioning profile on its own. Open the project once:',
      '  xed ios',
      'select the target → Signing & Capabilities → tick Automatically manage signing,',
      'pick your team, build once to the iPhone, then run npm run native again.',
    ],
  ],
  [/Your team has no devices/, ['Connect the iPhone by cable once so Xcode can register it with your team.']],
  [
    /NODE_BINARY|node: command not found|node: No such file/,
    [
      "Xcode's bundling phase could not find node. ios/.xcode.env.local names it;",
      'run npm run native from the shell you use node in, it rewrites that file.',
    ],
  ],
  [
    /The sandbox is not in sync with the Podfile\.lock|CocoaPods could not find compatible versions/,
    ['The pods no longer match the project: npm run native -- --clean'],
  ],
  [/Encoding::CompatibilityError/, ['CocoaPods needs a UTF-8 locale: export LANG=en_US.UTF-8']],
];

const hintsFor = (output) => HINTS.find(([pattern]) => pattern.test(output))?.[1] ?? [];

function errorLines(output, limit = 12) {
  const lines = output.split('\n');
  const picked = lines
    .filter((line) => /\berror\b|failed|ERROR:/i.test(line) && !line.includes('warning:'))
    .map((line) => line.trim());
  const unique = [...new Set(picked)].slice(-limit);
  return unique.length ? unique : lines.filter(Boolean).slice(-limit);
}

// Runs one step, its output to a log and its progress to the display: a bar
// when the tool prints percentages, a timer and a status line otherwise.
function stream(title, cmd, args, logName, { statusOf, percentOf, cwd = ROOT, env = {} } = {}) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const log = path.join(LOG_DIR, logName);
  const handle = fs.openSync(log, 'w');
  fs.writeSync(handle, `$ ${[cmd, ...args].join(' ')}\n\n`);
  const indicator = percentOf ? p.progress({ max: 100, style: 'heavy', size: 28 }) : p.spinner({ indicator: 'timer' });
  indicator.start(title);
  const started = Date.now();
  const collected = [];
  let reached = 0;
  let pending = '';
  // A status that wraps breaks the redraw: it gets what the line has left.
  const room = Math.max(12, (process.stdout.columns || 80) - title.replace(ANSI, '').length - (percentOf ? 48 : 16));
  const withStatus = (status) => `${title}  ${color('dim', status.slice(0, room))}`;

  const onLine = (raw) => {
    const line = raw.replace(ANSI, '');
    fs.writeSync(handle, `${line}\n`);
    collected.push(line);
    const status = statusOf?.(line);
    const value = percentOf?.(line);
    if (value != null && value > reached) {
      indicator.advance(value - reached, status ? withStatus(status) : undefined);
      reached = value;
    } else if (status) {
      indicator.message(withStatus(status));
    }
  };

  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const interrupt = () => child.kill('SIGTERM');
    process.once('SIGINT', interrupt);
    const feed = (chunk) => {
      pending += chunk.toString().replace(/\r(?!\n)/g, '\n');
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      lines.forEach(onLine);
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    const finish = (code, error) => {
      process.removeListener('SIGINT', interrupt);
      if (pending) onLine(pending);
      if (error) collected.push(String(error.message));
      fs.closeSync(handle);
      const seconds = (Date.now() - started) / 1000;
      const ok = code === 0;
      // The spinner's timer already prints the time it took, the bar does not.
      const label = percentOf ? `${title}  ${color('dim', `${seconds.toFixed(0)} s`)}` : title;
      // Ctrl-C has already stopped the spinner (clack listens for SIGINT).
      if (indicator.isCancelled) {
        // nothing left to draw
      } else if (ok) {
        indicator.stop(label);
      } else {
        indicator.error(label);
      }
      resolve({ ok, seconds, log, output: collected.join('\n'), interrupted: code === null });
    };
    child.on('error', (error) => finish(127, error));
    child.on('close', (code) => finish(code));
  });
}

const lastLine = (line) => {
  const text = line.trim().replace(/^[›»✔✓•-]\s*/, '');
  return text && !PERCENT.test(text) ? text.slice(0, 60) : '';
};

const podStatus = (line) => line.match(/^(?:Installing|Downloading dependencies|Generating Pods project|Integrating client project)\b.*/)?.[0].slice(0, 60) ?? '';

const XCODE_ACTIONS = [
  ['SwiftCompile', 'compiling Swift'],
  ['SwiftEmitModule', 'Swift modules'],
  ['CompileC', 'compiling'],
  ['Ld ', 'linking'],
  ['Libtool', 'archiving'],
  ['PhaseScriptExecution', 'running'],
  ['CodeSign', 'signing'],
  ['ProcessProductPackaging', 'entitlements'],
  ['ProcessInfoPlistFile', 'Info.plist'],
  ['CompileAssetCatalog', 'asset catalog'],
  ['CompileStoryboard', 'launch screen'],
  ['CopySwiftLibs', 'Swift libraries'],
  ['GenerateDSYMFile', 'debug symbols'],
  ['Validate', 'validating'],
];

function xcodeStatus(line) {
  const action = XCODE_ACTIONS.find(([prefix]) => line.startsWith(prefix));
  if (action) {
    const target = line.match(/\(in target '([^']+)'/)?.[1];
    const script = action[0] === 'PhaseScriptExecution' ? line.match(/PhaseScriptExecution (.+?) \//)?.[1]?.replace(/\\ /g, ' ') : '';
    return [action[1], script || target].filter(Boolean).join(' ');
  }
  if (line.includes('Signing Identity:') || line.includes('Provisioning Profile:')) return line.trim();
  return '';
}

function devicePercent(line) {
  const match = line.match(PERCENT);
  return match && Number(match[1]) <= 100 ? Number(match[1]) : null;
}

function fail(step, result) {
  if (result.interrupted) {
    p.cancel('Stopped.');
    return 130;
  }
  const body = errorLines(result.output).map((line) => color('red', line));
  const hints = hintsFor(result.output);
  if (hints.length) body.push('', ...hints.map((line) => color('bold', line)));
  body.push('', color('dim', `Full log: ${path.relative(ROOT, result.log)}`));
  p.box(body.join('\n'), `${step} failed`, { formatBorder: (text) => color('red', text) });
  p.outro(color('red', 'Not installed.'));
  return 1;
}

function directorySize(dir) {
  return filesUnder(dir).reduce((total, file) => total + fs.statSync(file).size, 0);
}

async function build(ctx, { mode, clean }) {
  const configuration = mode === 'release' ? 'Release' : 'Debug';
  const udid = ctx.device.hardwareProperties.udid;
  const coreId = ctx.device.identifier;
  const name = deviceName(ctx.device);
  const timings = [];
  // Only this run's logs: a prebuild log left from an earlier run would read
  // as part of this one.
  fs.rmSync(LOG_DIR, { recursive: true, force: true });

  const hash = prebuildHash();
  const reason = prebuildReason(clean, hash);
  if (reason) {
    const prebuild = await stream(
      `Generating ios/ from app.json  ${color('dim', `(${reason})`)}`,
      process.execPath,
      [path.join(ROOT, 'node_modules', 'expo', 'bin', 'cli'), 'prebuild', '--platform', 'ios', '--clean', '--no-install'],
      '1-prebuild.log',
      // ios/ is git-ignored, so the dirty-tree confirmation protects nothing
      // here, and without a terminal it is an error instead of a question.
      { statusOf: lastLine, env: { EXPO_NO_GIT_STATUS: '1' } },
    );
    if (!prebuild.ok || !projectName()) return fail('Prebuild', prebuild);
    timings.push(['Prebuild', prebuild.seconds]);
  } else {
    p.log.step(`ios/ is current  ${color('dim', 'nothing it is generated from changed')}`);
  }

  const workspace = () => fs.existsSync(path.join(IOS_DIR, `${projectName()}.xcworkspace`));
  if (reason || !podsInSync() || !workspace()) {
    const pods = await stream('Installing pods', 'pod', ['install'], '2-pods.log', {
      statusOf: podStatus,
      cwd: IOS_DIR,
    });
    if (!pods.ok || !workspace()) return fail('Pod install', pods);
    timings.push(['Pods', pods.seconds]);
  }
  // Stamped once the pods are in, so a failed install reruns both next time.
  fs.writeFileSync(PREBUILD_STAMP, `${hash}\n`);
  // Xcode's bundling phase runs node from this file. `expo prebuild --clean`
  // drops it, and a GUI-launched Xcode has no nvm on its PATH.
  fs.writeFileSync(path.join(IOS_DIR, '.xcode.env.local'), `export NODE_BINARY=${process.execPath}\n`);

  const scheme = projectName();
  const app =path.join(DERIVED_DATA, 'Build', 'Products', `${configuration}-iphoneos`, `${scheme}.app`);
  const compile = await stream(
    `Xcode build and signing  ${color('dim', `(${configuration})`)}`,
    'xcodebuild',
    [
      '-workspace',
      path.join(IOS_DIR, `${scheme}.xcworkspace`),
      '-scheme',
      scheme,
      '-configuration',
      configuration,
      '-destination',
      `id=${udid}`,
      '-derivedDataPath',
      DERIVED_DATA,
      '-allowProvisioningUpdates',
      '-allowProvisioningDeviceRegistration',
      'build',
      // The generated project has no team once ios/ is regenerated; this
      // signs every target, pods' resource bundles included, for this team.
      'CODE_SIGN_STYLE=Automatic',
      `DEVELOPMENT_TEAM=${ctx.team}`,
    ],
    '3-xcodebuild.log',
    { statusOf: xcodeStatus },
  );
  if (!compile.ok || !fs.existsSync(app)) return fail('Xcode build', compile);
  timings.push(['Xcode', compile.seconds]);

  const install = await stream(
    `Installing on ${name}`,
    'xcrun',
    ['devicectl', 'device', 'install', 'app', '--device', coreId, app],
    '4-install.log',
    { statusOf: lastLine, percentOf: devicePercent },
  );
  if (!install.ok) return fail('Install', install);
  timings.push(['Install', install.seconds]);

  const launch = await stream(
    'Launching',
    'xcrun',
    ['devicectl', 'device', 'process', 'launch', '--terminate-existing', '--device', coreId, ctx.bundle],
    '5-launch.log',
    { statusOf: lastLine },
  );
  if (!launch.ok) return fail('Launch', launch);
  timings.push(['Launch', launch.seconds]);

  const size = directorySize(app) / 1e6;
  const rows = [
    ['Device', name],
    ['Bundle', ctx.bundle],
    [
      'Build',
      mode === 'release'
        ? `Release, JS bundle embedded, ${size.toFixed(0)} MB app`
        : `Debug, ${size.toFixed(0)} MB app: the JS comes from Metro, run npm start`,
    ],
    ['Time', timings.map(([step, seconds]) => `${step} ${seconds.toFixed(0)} s`).join('  ')],
    ['Logs', path.relative(ROOT, LOG_DIR)],
  ];
  if (ctx.freeTeam) rows.push(['Expires', 'in 7 days (free team): run npm run native again then']);
  p.box(
    rows.map(([key, value]) => `${color('dim', key.padEnd(8))}${value}`).join('\n'),
    'Running on the iPhone',
    { formatBorder: (text) => color('green', text) },
  );
  p.outro('Done.');
  return 0;
}

function abort() {
  p.cancel('Stopped.');
  process.exit(130);
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        mode: { type: 'string', default: 'release' },
        device: { type: 'string' },
        team: { type: 'string' },
        check: { type: 'boolean', default: false },
        clean: { type: 'boolean', default: false },
      },
    }));
  } catch (error) {
    console.error(`${error.message}\nUsage: npm run native -- [--mode release|debug] [--device NAME|UDID] [--team ID] [--clean] [--check]`);
    return 1;
  }
  if (!['release', 'debug'].includes(values.mode)) {
    console.error(`--mode is release or debug, not "${values.mode}"`);
    return 1;
  }
  p = await import('@clack/prompts');

  if (process.platform !== 'darwin' || run('which', ['xcrun']).status !== 0) {
    p.log.error('xcrun not found: this needs macOS with Xcode.');
    return 1;
  }
  p.intro(`${color('bold', 'Komfy')}  ${color('dim', 'native iOS build')}`);

  const ctx = {
    wantedDevice: values.device,
    team: values.team || process.env.APPLE_TEAM_ID || readRememberedTeam(),
    bundle: '',
    teams: null,
    devices: null,
    device: null,
    freeTeam: false,
  };
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !values.check;
  if (!(await preflight(ctx, interactive))) {
    p.outro(color('red', 'Fix the above, then run it again.'));
    return 1;
  }
  if (values.check) {
    p.outro(`${color('green', 'Ready.')} ${color('dim', 'npm run native builds and runs it on the iPhone.')}`);
    return 0;
  }
  return build(ctx, values);
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
