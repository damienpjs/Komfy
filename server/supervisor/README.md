# Komfy supervisor

A tiny, **dependency-free** Node service that owns the ComfyUI **process
lifecycle** so the Komfy app can turn ComfyUI on/off remotely and watch its
console live — even when ComfyUI itself is down.

Why a separate service (not a ComfyUI custom node like `komfy-listing`): it has
to answer **when ComfyUI is not running**, so it cannot live inside ComfyUI's
process. It is started at boot by the OS service manager and listens on the
**Tailscale IP only**, same network doctrine as ComfyUI (README §Security).

## Three states the app shows

| Supervisor reachable? | ComfyUI (`/system_stats`)? | App shows |
|---|---|---|
| no                    | —              | **Server unreachable** (machine off / network) |
| yes                   | down           | **ComfyUI off** → *Turn on* |
| yes                   | up             | running → *Turn off* |

## Run it (foreground, for dev/test)

```bash
npm run supervisor          # = node server/supervisor/index.js
```

On first run it generates an auth token at `server/supervisor/.token`
(git-ignored). Then, from the repo root:

```bash
npm run pair                # prints a QR + komfy://setup deep link for the app
```

## Install at boot

| OS | Command |
|---|---|
| macOS   | `bash server/supervisor/install/install-macos.sh` (launchd LaunchAgent) |
| Linux   | `bash server/supervisor/install/install-linux.sh` (systemd user unit + linger) |
| Windows | `pwsh -File server\supervisor\install\install-windows.ps1` (Scheduled Task at logon) |

Each install script resolves `node` and the repo path, fills the template in
this folder, and registers/loads the service. Uninstall instructions are in the
header of each script.

On macOS the LaunchAgent sets `ProcessType` to `Interactive`. Without that key
launchd throttles the job's CPU and I/O, and ComfyUI inherits the limits from
the supervisor that spawns it: `ps -o pri= -p <ComfyUI pid>` shows 20 where a
shell shows 31, and a VoxCPM render with a converted tone clip took 109 s
against 95 s once the key was in. The agent's `PATH` also includes `/usr/sbin`
for `lsof`, which `/stop` and `/restart` need to find a ComfyUI started outside
the supervisor. An agent installed before these keys existed keeps the old
behaviour until `install-macos.sh` is run again. The reload restarts the
supervisor but not a running ComfyUI (it lives in its own process group), so
turn ComfyUI off and on from the app afterwards.

## HTTP / WebSocket API

| Method | Path | Auth | Result |
|---|---|---|---|
| GET  | `/health`      | no  | `{ supervisor, comfy: "up"\|"down"\|"starting", pid, since }` |
| POST | `/start`       | yes | `202 { starting:true }` · `409` if ComfyUI already runs |
| POST | `/restart`     | yes | `202 { starting:true }` · `409` if it does not stop within 20 s |
| POST | `/stop`        | yes | `200 { stopped:true }` · `409` if nothing to stop |
| GET  | `/ws?token=…`  | yes | WebSocket: replays recent log lines, then tails live |

`/start` and `/restart` accept an optional JSON body `{ "mode": "sdpa" }` or
`{ "mode": "split" }`: the attention backend handed to `scripts/start-comfy.*`.
It replaces the backend in `COMFY_START_ARGS` and keeps the other arguments
(`sdpa local` becomes `split local`). Any other value gets a `400`; no body
starts with `COMFY_START_ARGS` unchanged. `/restart` stops ComfyUI, waits
until its port stops answering, then starts it: chaining `/stop` and `/start`
from a client would hit the anti-double-launch `409`, since `/stop` returns
before the process has exited. A restart drops ComfyUI's in-memory queue.

Auth = a shared token via `Authorization: Bearer <token>` (HTTP) or `?token=`
(WebSocket). `/health` is open on purpose: up/down is harmless and lets the app
distinguish *unreachable* from *reachable* even before a token is configured;
process control and logs (which can contain filesystem paths) require the token.

WebSocket messages:

```jsonc
{ "type": "log",   "line": "…", "at": 1785… }          // one console line
{ "type": "state", "comfy": "starting"|"up"|"down" }   // lifecycle change
```

## How on/off works

- **Start** reuses the OS-agnostic launcher `scripts/comfy.js` →
  `scripts/start-comfy.{sh,ps1}`, spawned in its own process group. Those
  scripts `tee` ComfyUI's console to `<BASE_DIR>/logs/comfyui.log` (truncated
  each launch); the supervisor **tails that file** for the WS stream — so the
  app terminal works whether ComfyUI was started by the app **or** by hand with
  `npm run comfy`.
- **Stop** sends `SIGTERM` to the tracked process group (then `SIGKILL`). A
  ComfyUI started outside the supervisor is stopped best-effort by port lookup
  (`lsof`/`Get-NetTCPConnection`); if its PID can't be found the app is told so.
- **Anti-double-launch**: `/start` probes the ComfyUI port first and returns
  `409` if something already answers there.

## Config (env, all optional)

| Var | Default |
|---|---|
| `KOMFY_SUPERVISOR_PORT`   | `8189` |
| `KOMFY_SUPERVISOR_LISTEN` | `tailscale ip -4` (bind retried until it is up) |
| `KOMFY_SUPERVISOR_TOKEN`  | read/generate `server/supervisor/.token` |
| `KOMFY_COMFY_PORT`        | `8188` |
| `KOMFY_COMFY_HOST`        | the resolved listen address (ComfyUI listens on the Tailscale IP, **not** `127.0.0.1`) |
| `KOMFY_LOG_FILE`          | `<BASE_DIR>/logs/comfyui.log` |
| `BASE_DIR`                | matches `scripts/start-comfy.*` |
| `COMFY_START_ARGS`        | forwarded to `scripts/comfy.js`, e.g. `split` |

## Security

Same perimeter as the rest of Komfy: reachable over Tailscale only, never bound
to `0.0.0.0`, never port-forwarded. The token is the second line of defense for
process control; it is generated locally, never committed, and delivered to the
phone by the pairing QR — never typed into the repo or the app source.
