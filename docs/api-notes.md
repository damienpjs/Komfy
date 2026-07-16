# ComfyUI API notes — real responses

> Sprint 0 rule: **do not code the client on assumptions.** Every endpoint below must be tested against the real ComfyUI (Mac, Tailscale IP) and its response pasted here. The TS types in `src/api/types.ts` are derived from these responses.

Server: `http://100.x.y.z:8188` (MacBook's Tailscale IP, launched with `--listen $(tailscale ip -4)`)
ComfyUI version: **0.27.0** — frontend 1.45.20 · Python 3.12.11 · PyTorch 2.9.1 · **MPS** backend (M3 Max 64 GB)
Recorded on: 2026-07-10

## Checklist

### GET /system_stats
```bash
curl http://100.x.y.z:8188/system_stats
```
Response:
```json
{
  "system": {
    "os": "darwin",
    "ram_total": 68719476736,
    "ram_free": 8939569152,
    "comfyui_version": "0.27.0",
    "required_frontend_version": "1.45.20",
    "python_version": "3.12.11 (main, Aug 18 2025, 19:02:39) [Clang 20.1.4 ]",
    "pytorch_version": "2.9.1",
    "embedded_python": false,
    "deploy_environment": "local-desktop2-standalone",
    "argv": ["ComfyUI/main.py", "--listen", "100.x.y.z", "--port", "8188", "..."]
  },
  "devices": [
    {
      "name": "mps", "type": "mps", "index": null,
      "vram_total": 68719476736, "vram_free": 8939569152,
      "torch_vram_total": 68719476736, "torch_vram_free": 8939569152
    }
  ]
}
```
> On MPS, `vram_*` = shared system RAM (no dedicated VRAM). Useful for a memory indicator app-side.

### GET /queue
```bash
curl http://100.x.y.z:8188/queue
```
Response (empty queue):
```json
{"queue_running": [], "queue_pending": []}
```
Structure when jobs are present: each entry is a tuple
`[number, prompt_id, prompt_graph, extra_data, outputs_to_execute]`.
`queue_running` = running jobs, `queue_pending` = pending.

### POST /prompt
```bash
curl -X POST http://100.x.y.z:8188/prompt -H 'Content-Type: application/json' \
  -d '{"prompt": <workflow-api-json>, "client_id": "komfy-test"}'
```
Success response (note `prompt_id`, `number`):
```json
{"prompt_id": "1a37efff-dfa3-4289-9930-08b6d3838133", "number": 1, "node_errors": {}}
```

**Validation error** response (here: type mismatch + missing required input) — HTTP 400:
```json
{
  "error": {
    "type": "prompt_outputs_failed_validation",
    "message": "Prompt outputs failed validation",
    "details": "Return type mismatch between linked nodes: images, received_type(MODEL) mismatch input_type(IMAGE)\nRequired input is missing: filename_prefix",
    "extra_info": {}
  },
  "node_errors": {
    "9": {
      "errors": [
        {"type": "return_type_mismatch", "message": "Return type mismatch between linked nodes",
         "details": "images, received_type(MODEL) mismatch input_type(IMAGE)",
         "extra_info": {"input_name": "images", "received_type": "MODEL", "linked_node": ["4", 0]}},
        {"type": "required_input_missing", "message": "Required input is missing",
         "details": "filename_prefix", "extra_info": {"input_name": "filename_prefix"}}
      ],
      "dependent_outputs": ["9"]
    }
  }
}
```
Another case — graph without an output node: `{"error": {"type": "prompt_no_outputs", "message": "Prompt has no outputs", ...}, "node_errors": {}}`.
> **Validation** errors (checkpoint not found, type mismatch, missing input) come back here, not over WS. The client must read `error` + `node_errors` on the POST.

### WebSocket /ws
```bash
# ws://100.x.y.z:8188/ws?clientId=komfy-test
```
Real sequence captured on a text-to-image generation (SDXL, 768², 6 steps). One example of each type:

- `status` (also sent on connection):
  ```json
  {"type": "status", "data": {"status": {"exec_info": {"queue_remaining": 0}}, "sid": "komfy-test-043521"}}
  ```
- `execution_start`:
  ```json
  {"type": "execution_start", "data": {"prompt_id": "1a37efff-...", "timestamp": 1783691859274}}
  ```
- `execution_cached`:
  ```json
  {"type": "execution_cached", "data": {"nodes": [], "prompt_id": "1a37efff-...", "timestamp": 1783691859440}}
  ```
- `executing` (current node; `node: null` = end of the prompt's execution):
  ```json
  {"type": "executing", "data": {"node": "4", "display_node": "4", "prompt_id": "1a37efff-..."}}
  ```
- `progress` (sampler bar — `value` / `max`, with the `node`):
  ```json
  {"type": "progress", "data": {"value": 1, "max": 6, "prompt_id": "1a37efff-...", "node": "3"}}
  ```
- `progress_state` (per-node state, richer than `progress`):
  ```json
  {"type": "progress_state", "data": {"prompt_id": "1a37efff-...", "nodes": {"4": {"value": 0.0, "max": 1.0, "state": "running", "node_id": "4"}}}}
  ```
- `executed` (output node result — contains the files):
  ```json
  {"type": "executed", "data": {"node": "9", "display_node": "9",
    "output": {"images": [{"filename": "komfy_apitest_00001_.png", "subfolder": "", "type": "output"}]},
    "prompt_id": "1a37efff-..."}}
  ```
- `execution_success`:
  ```json
  {"type": "execution_success", "data": {"prompt_id": "1a37efff-...", "timestamp": 1783691958068}}
  ```
- `execution_error` (provoked: `filename_prefix` outside the output folder):
  ```json
  {"type": "execution_error", "data": {"prompt_id": "fb1b6a21-...", "node_id": "9", "node_type": "SaveImage",
    "executed": ["3", "5", "8", "7", "6"],
    "exception_message": "**** ERROR: Saving image outside the output folder is not allowed. ...",
    "exception_type": "Exception", "traceback": ["  File \".../execution.py\", line 542, in execute ..."]}}
  ```

> ⚠️ The **Crystools** custom node additionally emits a non-standard `crystools.monitor` stream (CPU/RAM/HDD) — to be ignored client-side:
> `{"type": "crystools.monitor", "data": {"cpu_utilization": 38.3, "ram_used_percent": 89.6, ...}}`

> ⚠️ **Per-client routing (verified Sprint 1)**: a job's `executing` / `progress` / `executed` messages are sent **to the `sid` that submitted it**, not broadcast. A third-party WS client only receives `status` (queue_remaining). Sprint 2 consequence: to follow a job launched from the desktop front-end, the "running job" card must rely on `GET /queue` polling (fallback already planned); fine-grained tracking (%) is only guaranteed for jobs queued by Komfy with its own `client_id`.

### POST /interrupt
```bash
curl -X POST http://100.x.y.z:8188/interrupt
```
Response: **HTTP 200**, empty body. Interrupts the running job (already-executed nodes are not replayed). No `execution_error` message; execution simply stops.

### POST /queue (delete / clear)
```bash
curl -X POST http://100.x.y.z:8188/queue -H 'Content-Type: application/json' -d '{"delete": ["<prompt_id>"]}'
curl -X POST http://100.x.y.z:8188/queue -H 'Content-Type: application/json' -d '{"clear": true}'
```
Responses: **HTTP 200**, empty body in both cases (including when the `prompt_id` to delete does not exist — no error).

### GET /view
```bash
curl -o test.png "http://100.x.y.z:8188/view?filename=<f>&subfolder=<s>&type=output"
```
- Existing file → returns the image (200).
- Missing file → **HTTP 404**.
- `type` accepts `output`, `input`, `temp`.
- Behavior with an evicted iCloud file (`.icloud`): **to test** (the output folder here is local to `~/Documents/ComfyUI/output`, not on iCloud → remember to check if the app points to an iCloud output).

### GET /internal/files/{directory} (output listing)
> ⚠️ The endpoint is **not** `/internal/files?directory=output` (→ 404) but `/internal/files/output`.
```bash
curl "http://100.x.y.z:8188/internal/files/output"
```
Response (flat list `"<name> [<type>]"`):
```json
["sunset.png [output]"]
```
Neighboring internal endpoints available (HTTP 200): `/internal/logs`, `/internal/logs/raw`, `/internal/folder_paths`.
`GET /internal/folder_paths` returns the type → real disk paths mapping:
```json
{"checkpoints": ["/Users/<user>/ComfyUI-Shared/models/checkpoints",
                 "/Users/<user>/Documents/ComfyUI/models/checkpoints", "..."], "...": ["..."]}
```
Behavior when the "ComfyUI" volume is not mounted: **to test** (health check probe).

### GET /history
```bash
curl http://100.x.y.z:8188/history
curl http://100.x.y.z:8188/history/<prompt_id>
```
Response (empty at startup: `{}`). After a job, `prompt_id` → `{status, outputs}` mapping:
```json
{
  "1a37efff-...": {
    "status": {"status_str": "success", "completed": true, "messages": ["..."]},
    "outputs": {"9": {"images": [{"filename": "komfy_apitest_00001_.png", "subfolder": "", "type": "output"}]}}
  }
}
```
`?max_items=N` parameter to limit. This is the source for finding a prompt's files (remix, Sprint 4b).

## Additional useful endpoints (recorded)
- `GET /object_info` → schema of **all** node types (**3447** here, custom nodes included). Several MB — never fetch it on mobile; use the per-node form below. Model lists (checkpoints, loras…) are injected inline into the schemas.
- `GET /models` → folder types (`checkpoints`, `loras`, `vae`, `controlnet`, `upscale_models`, …). `GET /models/{folder}` → files of the folder.

### GET /object_info/{NodeName} (availability check — recorded 2026-07-16)
```bash
curl "http://100.x.y.z:8188/object_info/UNETLoader"
curl "http://100.x.y.z:8188/object_info/ShowText%7Cpysssss"   # '|' in the name URL-encodes fine
curl "http://100.x.y.z:8188/object_info/DoesNotExistNode"     # → HTTP 200, {}
```
Response: single-key map `{"<NodeName>": {schema}}` — **`{}` with HTTP 200, never 404, when the
node type is unknown** (missing custom node). Per-node responses are 0.5–4 KB. Abridged real
response (UNETLoader):
```json
{"UNETLoader": {
  "input": {"required": {
    "unet_name": [["flux1-kontext-dev.safetensors", "krea2_turbo_bf16.safetensors", "..."]],
    "weight_dtype": [["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"], {"advanced": true}]}},
  "input_order": {"required": ["unet_name", "weight_dtype"]},
  "output": ["MODEL"], "output_is_list": [false], "output_name": ["MODEL"],
  "name": "UNETLoader", "display_name": "Load Diffusion Model", "description": "",
  "python_module": "nodes", "category": "model/loaders", "output_node": false}}
```
- Input spec = `[type-or-enum, options?]`: `["INT", {"default": 5, "min": -1, …}]`,
  `["STRING", {"multiline": false, …}]`, or an **enum** whose first element is the array of
  allowed values. Installed model files surface as these enums (`unet_name` above,
  `UltralyticsDetectorProvider.model_name`: `["bbox/face_yolov8m.pt", …, "segm/person_yolov8m-seg.pt"]`).
- ⚠️ An enum can be **empty yet valid at runtime**: `OllamaConnectivityV2.model` returns `[[]]`
  (the list is only populated by the front-end's refresh button — its tooltip says so) while a
  literal model name works at execution. **Never flag a value against an empty enum.**
- Used by `src/workflows/requirements.ts` + `useAvailability` to flag workflows whose custom
  nodes or model files are missing on the connected server.
  - `GET /models/checkpoints`: `["someModel_xl.safetensors", "anotherModel_v2.safetensors", ...]` (installed checkpoint filenames).
- `GET /embeddings` → **overridden by the LoRA-Manager custom node**: returns HTML, not the core JSON. Do not rely on it.
- `GET /features` → `{"supports_preview_metadata": true, "max_upload_size": 104857600, "node_replacements": true, "assets": false, "extension": {"manager": {...}}}`.
- Unknown route → **HTTP 404**.

## PNG metadata (remix)
```bash
python3 -c "from PIL import Image; im=Image.open('test.png'); print(im.info.keys())"
```
Content observed on an image generated **via the API**:
```
size: (768, 768)  mode: RGB
info keys: ['prompt']
  prompt: {"4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "someModel_xl..."}}, ...}
```
> ⚠️ **Important for remix**: an image submitted via `POST /prompt` only contains the `prompt` chunk (the API graph). The `workflow` chunk (front-end editor graph) is **only** added when the client sends `extra_data.extra_pnginfo.workflow` in the request. If Komfy wants to allow remixing from the editor, it must either re-read `prompt` or explicitly send `workflow` on submission.

### Komfy extension routes (`server/komfy-listing`)
Multi-root file manager over ComfyUI's `output` **and** `input` folders. Every
path is **prefixed by its root**; moves across roots are allowed. `503` on all
routes when the output volume is not mounted, `404` when the extension is not
installed / ComfyUI not yet restarted (→ history fallback app-side). Installed
via a symlink into `custom_nodes/`; active after a ComfyUI restart.

- `GET /komfy/files` — **recursive** listing of both roots:
  `[{"path": "output/workflows/Krea2/2026-07-10/Krea2_00044_.png", "mtime": 1783718794}, {"path": "input/photo.png", "mtime": …}, …]`
  (3881 files in ~0.3 s on the real volume). The bare roots (`{"path": "output", "dir": true}`)
  and empty folders (`"dir": true`) are also emitted so they stay visible.
- `POST /komfy/delete` `{"paths": ["output/a.png", "input/b.png"]}` → soft-delete
  to `<root>/.komfy-trash/<timestamp>/<sub path>`. `{"moved": [...], "errors": {...}}`.
- `POST /komfy/move` `{"paths": [...], "dest": "output/sub"}` → move into `dest`
  (prefixed, or a bare root). `{"moved": [...], "errors": {...}}`.
- `POST /komfy/mkdir` `{"path": "input/sub"}` → `{"created": "input/sub"}`.
- `GET /komfy/trash` → per-root trash stats `{"output": {"count": N, "bytes": B}, "input": {…}}`.
- `POST /komfy/trash/empty` `{}` (all roots) or `{"root": "input"}` → **permanent** rm,
  returns `{"freed": {"output": {"count": N, "bytes": B}, …}}`.

> Upload into `input` reuses the core `POST /upload/image` (`type=input`, optional
> `subfolder`) — the extension is only needed to browse/manage the roots, not to upload.
