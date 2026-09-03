# Komfy — MVP Roadmap

Mobile remote (iOS/Android) for the local ComfyUI pipeline (reference machine: MacBook Pro M3 Max 64 GB, MPS backend).

**Repo**: `komfy` · **Suggested working directory**: `~/komfy`
**Stack**: React Native + Expo (TypeScript) · **Network**: Tailscale only (see Security)

---

## 0. Technical context (read before any code)

> **Reference setup, not a requirement.** The specifics in this section
> (MacBook Pro M3 Max / MPS, an iCloud Drive "ComfyUI" volume as the output
> folder) describe the **maintainer's** machine when this was written.
> **Nothing in the code depends on them**: Komfy talks to whatever host,
> folders and compute backend ComfyUI is configured with — macOS, Linux or
> Windows alike. On a standard install where `output` is an ordinary,
> always-present folder, the iCloud "evicted file" / "volume not mounted"
> caveats below simply never fire. See
> `docs/portability.md` (local notes) for the OS-agnostic runguide.

### Target server

- ComfyUI runs on the server machine, by default `http://127.0.0.1:8188`.
- **Prerequisite**: launch ComfyUI with `--listen <tailscale-ip>` (e.g. `--listen 100.x.y.z`) so it is reachable from the phone through the tailnet — **not `0.0.0.0`** (see Security).
- The output folder is whatever ComfyUI is configured to serve (`--base-directory` / `--output-directory`). On the maintainer's machine it is an iCloud Drive "ComfyUI" volume (`~/Library/Mobile Documents/…/ComfyUI/output`); on a standard install it is an ordinary local folder.

### ComfyUI API used (everything already exists server-side, zero backend to write)

| Need                                    | Endpoint                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| Queue a workflow                         | `POST /prompt` (API-format JSON + `client_id`)                                       |
| Queue state (running + pending)          | `GET /queue`                                                                         |
| Real-time progress (job %)               | WebSocket `/ws?clientId=…` (`progress`, `executing`, `executed`, `status` messages)  |
| Interrupt the running job                | `POST /interrupt`                                                                    |
| Delete items / clear the queue           | `POST /queue` with `{"delete":[ids]}` or `{"clear":true}`                            |
| Display an image                         | `GET /view?filename=…&subfolder=…&type=output`                                       |
| List output folders/files                | `GET /internal/files?directory=output` (recent) — otherwise `GET /history` fallback  |

⚠️ **Cloud-synced volume caveat** (maintainer's iCloud setup; never fires on a plain local folder): files can be locally "evicted" (`.icloud` placeholder). The listing may show files that `/view` will not serve immediately. Handle the error cleanly app-side (retry + message).

⚠️ **Output folder unavailable**: if the output folder is missing (e.g. a cloud volume not mounted on the server), the file endpoints fail. The app must detect it (`GET /internal/files/output` failing while `GET /queue` answers) and show an **explicit error**: persistent "output folder unavailable on the server" banner + disabled gallery, instead of an empty screen or a crash. Automatic periodic re-check.

### Style guide

**ComfyUI look, adapted for mobile**: the app must feel like a native extension of ComfyUI, but designed for touch (not a desktop port).

- **Palette**: dark theme by default — deep grey backgrounds (`#1a1a1a` / `#252525`, ComfyUI-canvas style), `#2d2d2d` surfaces, main node-blue accent (`#4a90d9` ≈ the link/node blue), semantic accents: execution green for progress, red for destructive actions (interrupt/clear), yellow/orange for warnings (output folder unavailable).
- **Type**: Inter (via `expo-font`) for the UI, JetBrains Mono for technical values (seeds, filenames, prompt IDs).
- **Components**: generous rounded corners, node-style cards, thick progress bar readable at arm's length, touch targets ≥ 44 pt, haptics on actions.
- Centralize everything in `src/theme/` (color, spacing, type tokens) from Sprint 1 on — no hardcoded styles in screens.

### Workflow format

Export from ComfyUI in **API format** (Settings → Dev mode → "Save (API Format)"). Each workflow embedded in the app = one frozen JSON + a list of patchable fields (text prompt, input image, seed…) patched before `POST /prompt`.

---

## Security (simple model, suited to personal use)

**Principle: the ComfyUI API has NO authentication.** Anyone who reaches port 8188 can queue jobs, read images and upload files. All security relies on network access control — provided here by Tailscale (encrypted WireGuard tunnel, explicitly authorized devices).

Rules to follow (agent and human alike):

1. **Never any internet exposure**: no port forwarding on the router, no public tunnel (ngrok & co) to 8188.
2. **Bind to the Tailscale interface only** (`--listen <tailscale-ip>`), never `0.0.0.0` — a laptop joins public Wi-Fi networks, and `0.0.0.0` would expose the API to the whole network there. Tailscale also works at home: a single URL, no "direct LAN" mode.
3. **Clean tailnet**: only the server machine + the owner's phone(s); optional: a Tailscale ACL restricting port 8188 to the phone.
4. **App side**: no embedded or committed secret; the server URL stays in local storage.
5. **ComfyUI custom nodes**: ComfyUI's main known attack vector (code execution) — only install reputable/audited nodes. Outside the app's perimeter but worth keeping in mind.
6. OS firewall enabled on the server; it costs nothing.

What we do **not** do (useless here): HTTPS/certificates (the tunnel already encrypts), app-level auth, reverse proxy.

---

## Sprint 0 — Setup & checks (½ day)

- [ ] Create `~/Developer/komfy`, `git init`, private GitHub repo `komfy`.
- [ ] `npx create-expo-app komfy --template` (TypeScript), Expo Router.
- [ ] Install/validate Tailscale on the server machine + iPhone/Android; note the server's Tailscale IP.
- [ ] Launch ComfyUI with `--listen <tailscale-ip>`; verify from the phone (Tailscale active): `http://100.x.y.z:8188/queue` answers. Also verify the port is **not** reachable through the regular LAN IP.
- [ ] Confirm the output folder path and that `--base-directory` / `--output-directory` points to it (on the maintainer's machine, the iCloud "ComfyUI" volume).
- [ ] Manually test the endpoints in the table above (curl/Postman) and record the real responses in `docs/api-notes.md` — **do not code the client on assumptions**.
- [ ] Minimal CI: `tsc --noEmit` + ESLint in pre-commit (husky) or a GitHub Action.

**Deliverable**: empty Expo app building on the phone (Expo Go), `docs/api-notes.md` filled in.

## Sprint 1 — API layer & connection (1 day)

- [x] `src/api/client.ts`: typed HTTP client (fetch) with a configurable `baseUrl`.
- [x] `src/api/ws.ts`: WebSocket hook (`/ws?clientId`) with auto reconnection + parsing of the `status`, `progress`, `executing`, `executed`, `execution_error` messages.
- [x] TS types for every response (`QueueResponse`, `PromptResponse`, `ProgressMessage`…), derived from `docs/api-notes.md`.
- [x] **Settings** screen: server URL entry/edit, connection test, persistence (AsyncStorage), online/offline indicator in the header.
- [x] State management: Zustand (light) + TanStack Query for cache/refetch.
- [x] `src/theme/`: style guide tokens (colors, Inter + JetBrains Mono type via `expo-font`, spacing) — see the Style guide section. No hardcoded styles afterwards.
- [x] "Volume mounted" health check: periodic probe of `GET /internal/files/output` (real path, cf. api-notes); global `volumeMounted` state in the store, explicit error banner shown everywhere when it is false.

**Deliverable**: the app shows "connected" and logs WS events in real time.

## Sprint 2 — Queue: tracking & control (1–2 days)

Core of the MVP UX.

- [x] **Queue** screen (home screen):
  - [x] "Running job" card: workflow name, progress bar (% from `progress.value/max` — Komfy jobs only, cf. WS routing by sid in api-notes; indeterminate bar for third-party jobs), currently executing node, elapsed time.
  - [x] "Pending" list: position, workflow, per-item swipe-to-delete.
  - [x] Global badge: `N pending` always visible (tab bar).
- [x] **Interrupt** button (running job) → `POST /interrupt` + confirmation.
- [x] **Clear queue** button → `POST /queue {"clear":true}` + confirmation.
- [x] Item deletion → `POST /queue {"delete":[id]}` with optimistic update.
- [x] Source of truth: WS when connected, `GET /queue` polling (5 s) as fallback.
- [x] Polished empty/error states (server unreachable, empty queue).

**Deliverable**: from the couch, watch the progress and kill/purge the queue.

## Sprint 3 — Launching workflows (1–2 days)

- [x] `src/workflows/`: one file per embedded workflow (API JSON + TS manifest: name, icon, description, patchable fields with type/default/validation).
- [x] **Workflows** screen: card grid (Create, Detect & Replace, …).
- [x] Launch screen: form generated from the manifest (text, number, random seed, image picker via `/upload/image` when the workflow requires one).
- [x] JSON patch (replacement of the targeted node values) → `POST /prompt` → toast + redirect to the Queue.
- [x] **(beyond the initial roadmap)** Generic LoRAs field: recursive exploration of the `loras` folder, file-manager style (breadcrumb, global search), multi-select with a strength slider, `LoraLoaderModelOnly` chain inserted dynamically at patch time (`komfy_lora_N`).
- [x] **(beyond the initial roadmap, 2026-08-06)** Hand-drawn mask field (`mask` kind) + the `inpaint-draw` workflow: the user paints the area to regenerate over the source image (brush, eraser, undo, pinch-to-zoom), and picks the model freely (`modelSource`: any checkpoint, or diffusion model + CLIP + VAE) along with steps/cfg/sampler/scheduler/denoise/feather. **Decision: no native canvas** — Skia and view-shot would both have cost the Expo Go distribution (option A below), so the strokes are rasterized and PNG-encoded in pure JS (`utils/maskRaster.ts` + `utils/png.ts`: capsule rasterizer with soft edges, deflate *stored* blocks, no zlib dependency), uploaded via `/upload/image` and read back by `LoadImageMask`. The same rasterizer draws the on-screen overlay, so the preview is the mask itself.
- [x] **(beyond the initial roadmap, 2026-08-14)** `krea2-edit` workflow: instruction-driven edit (Krea2 Edit nodes — the source is a reference, the prompt describes the change, no mask). Two additions it needed, both generic: **fixed LoRAs** (`LorasField.fixed`) for the identity-edit weights the workflow is built around — inserted at the head of the chain at patch time rather than frozen as a graph node, so the remix absorption does not turn them back into a removable user LoRA — and an **output canvas computed from the source image** (`ImageResizeKJv2` INT outputs wired into the empty latent: source size, a 1/2 MP budget on the source ratio, or manual). Auto and manual share the same wiring, only widget values differ, so every render remixes back.
- [ ] Integrate 2 real workflows — **1/2 done**: KREA2 Turbo t2i embedded (validated against /object_info). The 2nd (Detect & Replace?) remains to be provided.

**Deliverable**: queue a job from the phone, watch it progress, retrieve the image.

## Sprint 4 — Output gallery (1–2 days)

- [x] **Gallery** screen: navigation through the `output/` folders. ⚠️ **Verified in the ComfyUI 0.27 source**: `/internal/files/{type}` only lists first-level files (no folders, no recursion) → the planned fallback became the main solution: tree rebuilt from `GET /history` (current session) + root files. Full archive coverage provided by the `server/komfy-listing` extension (automatic history fallback when not installed).
- [x] Thumbnail grid (via `/view`, with the `expo-image` disk cache).
- [x] Full-screen view: zoom, swipe between images, metadata when available. Amended post-MVP (2026-07-17): vertical swipe split — down still dismisses, up opens a file details sheet (name, folder, dimensions, size, created/modified dates; `/komfy/files` now emits `size` + `ctime`). Amended (2026-07-28): the details sheet now also covers videos — pixel dimensions (from the `expo-video` track) plus duration, alongside the shared size/date rows.
- [x] ~~Read-only~~ Amended post-MVP (2026-07-11): long-press on an image/folder → context menu (variant, Photos, **delete**). Deletion = `output/.komfy-trash/` trash via `POST /komfy/output/delete` (komfy-listing extension), never a definitive rm.
- [x] Handling of evicted/unavailable output files (e.g. an iCloud `.icloud` placeholder): retry + explicit message.
- [x] "ComfyUI volume not mounted" banner (Sprint 1 state): gallery disabled with a clear message, never a silent empty screen.

**Deliverable**: browse all output folders from the phone.

## Sprint 4b — Remix from an image (1–2 days)

ComfyUI embeds the full workflow and parameters in the PNG metadata (`prompt` and `workflow` tEXt chunks). Feature: from a gallery image, **start again from its recipe to create a variant**.

- [x] Metadata extraction from an image:
  1. Attempt via `GET /history` (filename → original prompt mapping) — fast when the history still exists;
  2. Fallback: download the PNG via `/view` and parse the tEXt chunks app-side (light TS PNG parser — no native lib required).
- [x] Matching: compare the extracted graph against the app's embedded workflows (class_type/structure fingerprint). If it matches a known workflow → pre-fill its launch form with the extracted parameters (prompt, seed, etc.).
- [x] UI: **"Create a variant"** button in the full-screen view. Accepted deviation from the initial plan: button always active, verdict on tap (spinner then an explicit "image without metadata" / "unknown workflow" message) — anticipating the check would have required downloading every PNG on swipe, prohibitive on 4G. Amended (2026-07-28): also enabled for videos — the recipe comes from `/history` (native `SaveVideo` lists the `.mp4` under `outputs.images`); a manifest holding several LoRA chains now attributes each to its own field (was merging them), and the matcher tolerates optional branches switched off via `bypassNodes` (e.g. last-frame).
- [x] Editable pre-filled form → new seed by default → `POST /prompt`. Amended (2026-08-05): the source image's seed travels alongside the values (`seeds` route param, never a form value) and is offered under the seed field — one tap to freeze the noise and iterate on the prompt alone. Generic: it lives in the `seed` field renderer and in the Detect & Replace shared seed (`ZonesField`), so every workflow — embedded or imported — gets it.
- [x] Case not handled in the MVP: workflow unknown to the app (valid metadata but a different graph) → explicit message, no raw re-queue attempt (v2 backlog: re-queue of the graph as-is).

**Deliverable**: long-press/open an image → "Create a variant" → job queued with the same parameters, different seed (or the original one, on request).

Related (2026-08-05): the file details sheet (swipe up in the full-screen viewer) now also reads the recipe — model, prompts, **seed**, sampling, LoRAs — via the same extraction, so consulting the seed no longer requires going through the variant flow.

## Sprint 5 — Polish & distribution (1 day)

- [x] Local "job finished" / "job failed" notification (emitted when the app is not active; covers the recent background — iOS closes the WS ~30 s after backgrounding; remote push out of scope).
- [x] Dark mode (native since Sprint 1), haptics (interrupt, clear, swipe-delete, launch), Komfy icon + splash ("K" as a node graph, generated in assets/images).
- [ ] **(to do on device)** Final verification: full real journey (queue 3 jobs → follow → delete 1 → interrupt → gallery) on iOS **and** Android, at home **and** on 4G/5G via Tailscale.
- [x] Security check: no secret in the repo (scan OK). — [ ] **(to do)** port 8188 unreachable outside the tailnet (test from a non-enrolled device).
- [x] Distribution — **decision: option A (Expo Go + EAS Update)**, zero Xcode, zero paid account: `eas update` publishes the JS bundle, the app launches from Expo Go without a dev server (procedure in the README). Moving to `eas build`/TestFlight (option B, paid Apple Developer account) stays possible without code changes. — [ ] **(to do)** `eas login` + `eas init` + `eas update:configure` + first `eas update`.
- [x] README: server setup (ComfyUI flags, Tailscale, listing extension), app setup, EAS Update publishing, adding a new workflow, security, structure.

**Deliverable**: app installed on the phone, usable daily.

---

## Sprint 6 — Remote power & live console (post-MVP)

- [x] **Supervisor** (`server/supervisor/`) — dependency-free Node service, boot-installed (launchd / systemd / Task Scheduler), Tailscale-bound on port 8189, owning the ComfyUI process lifecycle. `GET /health`, `POST /start`·`/stop` (bearer token), `GET /ws` log stream, anti-double-launch guard (endpoints in api-notes).
- [x] **Live console** — `start-comfy.*` `tee` ComfyUI's output to a per-session `logs/comfyui.log`; the supervisor tails it → in-app terminal (`app/comfy-console.tsx`), so logs stream whether ComfyUI was started from the app **or** by hand (`npm run comfy`).
- [x] **Server power card** (Settings) — three states (unreachable / off / on) + Turn on/off, driven by `useSupervisor` (health poll); the "went unreachable" transition is caught via `errorUpdatedAt`/`dataUpdatedAt`, not `isError` (react-query keeps stale data).
- [x] **Pairing** — `npm run pair` prints a `komfy://setup` QR (server URL + supervisor URL + token); scanned in-app (`PairingScanner`, expo-camera — included in Expo Go), pasted, or opened as an OS deep link. Manual entry still works (a bare IP/host gets `:8188`).
- [ ] **(to do on device)** Full journey on iOS + Android: pair by QR → turn on → watch console → turn off.

**Deliverable**: turn the ComfyUI server on/off from the phone, with a live console.

---

## Out of MVP scope (v2 backlog)

~~Image upload into the gallery~~ (done — upload into `input`, now a browsable gallery root alongside `output`) · ~~emptying the trash from the app~~ (done — Settings → Empty trash, permanent, with a file-count/size confirmation) · restoring files from the trash (batch and/or individual) · ~~workflow editing in the app~~ (done 2026-07-17, imported workflows only — manifest editor: rename, relabel/reorder/remove fields, add fields from a graph inspector, auto-detected LoRA fields, manifest JSON export/import to share between phones; embedded workflows stay code) · remote push notifications · multi-server · enriched history with generation parameters · relaunching a job from the history · remixing images whose workflow is not embedded in the app (raw graph re-queue) · ~~server capability check~~ (done 2026-07-16 — Workflows cards flag missing custom nodes/model files against `/object_info/{NodeName}`, cf. api-notes; first step of the "generic app" track) · ~~model choice from the server's installed files~~ (done 2026-07-16 — `model` field kind fed by the target's `/object_info` enum, family `filter`, per-workflow `remember`; the KREA2 workflows' UNet is now pickable) · ~~runtime workflow import~~ (done 2026-07-17 — paste an API-format JSON (Workflows → Import) or import an unknown image's recipe from the gallery; fields inferred (`infer.ts`), LoRA chains absorbed into an editable field, persisted on the phone, remixable, availability-checked).

## Frozen decisions

| Topic     | Decision                                                                                    |
| --------- | ------------------------------------------------------------------------------------------- |
| Stack     | Expo + React Native + TypeScript, Expo Router, Zustand, TanStack Query                      |
| Network   | Tailscale only (bind to the Tailscale IP, never 0.0.0.0, never internet exposure)           |
| Backend   | None — native ComfyUI API only                                                              |
| Workflows | Embedded (API JSON + manifest)                                                              |
| Gallery   | Read via `/internal/files` + `/view` (+ komfy-listing extension) — Images half of the Library tab |
| Prompts   | Generated prompts kept phone-side (AsyncStorage), never sent to the server. Sibling of the gallery under the Library tab, never a fake root inside its file tree: that tree mirrors real server folders and blanks out when the server is unreachable, which would take the local prompts down with it |

## Repo structure

```
komfy/
├── app/                  # screens (Expo Router): queue, workflows, library (images + prompts), settings
├── src/
│   ├── api/              # client.ts, ws.ts, types.ts
│   ├── workflows/        # API JSON + manifests
│   ├── store/            # Zustand
│   └── components/
├── docs/api-notes.md     # real endpoint responses (Sprint 0)
└── README.md
```
