# Komfy

Mobile remote (iOS/Android) for a local ComfyUI instance: follow and control
the queue, launch embedded workflows (with LoRAs), browse the output
gallery, remix an image from its recipe. UI in English and French
(selector in Settings).

> Personal project: the embedded workflows are tailored to a specific
> setup (KREA2 models, Impact Pack detectors, local Ollama). The code —
> API client, graph patching, remix, gallery — is generic and reusable
> for other workflows.

Stack: Expo SDK 54 (React Native + TypeScript), Expo Router, Zustand,
TanStack Query, i18next. Network: **Tailscale only**. See
[docs/api-notes.md](./docs/api-notes.md) for the real API responses
(source of truth for the TS types).

## Prerequisites

Mac side (server):

- **ComfyUI** installed, with the models referenced by the manifests in
  `src/workflows/` (KREA2 Turbo checkpoint, Qwen VAE/CLIP, Ultralytics
  detectors — see each workflow file);
- **Custom nodes**: [ComfyUI-Impact-Pack](https://github.com/ltdrdata/ComfyUI-Impact-Pack)
  and [Impact-Subpack](https://github.com/ltdrdata/ComfyUI-Impact-Subpack)
  (detection, DetailerForEach), [comfyui-ollama](https://github.com/stavsap/comfyui-ollama)
  and [ComfyUI-Custom-Scripts](https://github.com/pythongosssss/ComfyUI-Custom-Scripts)
  ("→ Prompt" workflows);
- **Ollama** running locally (`127.0.0.1:11434`, never exposed on the
  tailnet) with a vision model tagged `gemma4-vision:latest` — only for the
  "→ Prompt" workflows. Any Gemma-class vision model works; alias yours
  with `ollama cp <your-model> gemma4-vision:latest`;
- **Tailscale** connected (see Security).

Development / phone side:

- **Node 20+** and npm;
- **Expo Go** (SDK 54 build) on the phone, **Tailscale** connected to the
  same tailnet as the Mac;
- an Expo account (free) only for EAS Update publishing.

## Mac setup (once)

1. **Tailscale** installed and connected on the Mac and the phone (same
   tailnet). Mac IP: `tailscale ip -4` → `100.x.y.z`.
2. **ComfyUI** launched listening on the Tailscale interface **only**
   (never `0.0.0.0`, never port forwarding or a public tunnel):

   ```bash
   cd ~/ComfyUI-Installs/ComfyUI
   ~/Documents/ComfyUI/.venv/bin/python3 ComfyUI/main.py \
     --listen $(tailscale ip -4) --port 8188 \
     --preview-method auto \
     --base-directory ~/Documents/ComfyUI \
     --user-directory ~/Documents/ComfyUI/user_tailscale \
     --output-directory ~/Documents/ComfyUI/output \
     --input-directory ~/Documents/ComfyUI/input \
     --extra-model-paths-config "$HOME/Library/Application Support/Comfy Desktop/shared_model_paths.yaml"
   ```

   (A `comfy-server` agent in `.claude/agents/` knows how to rediscover and
   relaunch this configuration.)
3. **Listing extension** (full gallery) — symlink then restart ComfyUI:

   ```bash
   ln -s "<repo>/server/komfy-listing" ~/Documents/ComfyUI/custom_nodes/komfy-listing
   ```

   Details: [server/komfy-listing/README.md](./server/komfy-listing/README.md).
   Without it, the gallery falls back to the current session's history.

## App setup (development)

```bash
npm install
npm start          # Metro announced on the Tailscale IP → works on Wi-Fi AND 4G/5G
```

On first launch, set the server URL in Settings
(`http://<tailscale-ip>:8188`) → tested and persisted on the phone.

`npm start` announces Metro on the **Tailscale IP** (a single URL, at home
and on cellular — like the API). ⚠️ Known pitfalls:

- **always scan the QR code of the current session** — Expo Go's
  "Recently opened" history keeps old LAN URLs (`exp://192.168…`) that
  fail on mobile data (long-press to delete them);
- check that Expo Go is allowed to use cellular data
  (iOS Settings → Cellular);
- `npm run start:lan`: local-IP fallback when Tailscale is down.

EAS Update publishing (below) removes the question entirely: the bundle
then comes from Expo's CDN.

## Publishing without the Mac running (EAS Update + Expo Go)

The app is pure JS: no native build needed, Expo Go is enough.
Once published, it launches from Expo Go **without** a dev server.

First time (Expo account required, free):

```bash
npm i -g eas-cli
eas login
eas init                  # links the project (projectId in app.json)
eas update:configure      # adds updates.url + runtimeVersion
eas update --branch main --message "v1"
```

Then on the iPhone: open the URL printed by the command once (or
`exp://u.expo.dev/<projectId>?channel-name=main`) — it then stays in Expo
Go's history. On every change: `eas update --branch main`.

Moving later to a real installed app (Komfy icon, TestFlight): paid Apple
Developer account + `eas build --profile preview --platform ios` — no code
changes.

## Adding a workflow

1. In ComfyUI: Settings → Dev mode → **Save (API Format)**.
2. Create `src/workflows/<id>.ts`: paste the graph, write the manifest
   (name, icon, description, `saveNodeId`, patchable fields — see
   [krea2-text2img.ts](./src/workflows/krea2-text2img.ts) as a model).
   Field kinds: `text`, `number`, `seed`, `select`, `model`, `dimensions`,
   `image`, `loras`, `persons`. A `model` field offers the files actually
   installed on the server (its target's `/object_info` enum, optional
   family `filter` regex) instead of freezing a filename.
   User-facing manifest strings are i18n keys — add them to
   [src/i18n/en.ts](./src/i18n/en.ts) and [fr.ts](./src/i18n/fr.ts).
3. Register it in [src/workflows/index.ts](./src/workflows/index.ts).
4. Check the `class_type`s and model filenames against the real server's
   `GET /object_info` (rule: never guess).

Bonus: an embedded workflow automatically becomes **remixable** — the
gallery's "Create a variant" button matches images generated with it
(even with different node IDs) and pre-fills the form. The Workflows
screen also checks every workflow against the connected server
(`/object_info/{NodeName}`): cards whose custom nodes or model files are
missing get a warning badge listing exactly what to install.

## Security

The ComfyUI API has **no authentication**: all security is network access
control, provided by Tailscale (WireGuard, explicitly enrolled devices).

- Bind to the Tailscale IP only — never `0.0.0.0`, never internet
  exposure (router, ngrok…).
- Tailnet restricted to the Mac + phone(s); optional: ACL on port 8188.
- No secret in the repo or the app; the server URL lives in AsyncStorage.
- The `komfy-listing` extension makes no outgoing calls. Deletion is soft
  (move to a per-root `.komfy-trash`); the only permanent removal is the
  explicit, confirmed "Empty trash" action in Settings.
- Useful periodic check: port 8188 must be unreachable from a device
  outside the tailnet.

## Responsible use

Komfy is a remote control for **your own** ComfyUI instance: what gets
generated is entirely determined by the models and workflows you choose to
run. The embedded FaceSwap workflow edits faces in a source image; it is
intended for creative work on your own photos or with the **explicit
consent** of the people depicted. Do not use it to impersonate or deceive,
or to produce non-consensual or intimate imagery of real people — such use
is illegal in many jurisdictions and contrary to the intent of this
project.

## Structure

```
komfy/
├── src/app/              # screens (Expo Router): (tabs)/queue·workflows·gallery·settings, workflow/[id], ws-log
├── src/api/              # client.ts, ws.ts (WebSocket), types.ts, queryClient.ts
├── src/i18n/             # i18next setup + en/fr dictionaries (default: English)
├── src/workflows/        # manifests + frozen API graphs, patch.ts, match.ts (remix), requirements.ts (availability)
├── src/components/       # UI (queue cards, LoRA/folder pickers, viewer…)
├── src/store/            # Zustand: settings, connection, execution, toast, outputPrefs
├── src/hooks/            # useQueue, useGallery, useLoras, useRemix, useHealthCheck, useAvailability
├── src/utils/            # pathTree (explorer), pngMetadata (tEXt chunks)
├── src/theme/tokens.ts   # style guide — no hardcoded styles elsewhere
├── server/komfy-listing/ # ComfyUI extension (recursive output+input listing, trash)
└── docs/api-notes.md     # real API responses (Sprint 0 and later)
```
