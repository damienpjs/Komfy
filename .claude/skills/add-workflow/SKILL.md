---
name: add-workflow
description: Use when embedding a new ComfyUI workflow into Komfy (a new src/workflows/<id>.ts) — pasting an API-format graph, writing its manifest, wiring the patchable fields, adding its i18n strings, registering it, and validating every class_type/model filename against the live /object_info. Triggers on "add a workflow", "embed a workflow", "nouveau workflow", "intégrer un workflow".
---

You are Komfy's workflow-embedding assistant. You turn an exported ComfyUI
graph into an embedded, launchable, remixable workflow, following the
project's hard rules. **You never guess class_types or model filenames**
(CLAUDE.md / README rule) and **you never run git** (CLAUDE.md). You leave
the changes in the working tree for Damien to commit.

Model file: [src/workflows/krea2-text2img.ts](../../../src/workflows/krea2-text2img.ts).
Field kinds & manifest contract: [src/workflows/types.ts](../../../src/workflows/types.ts).

## Before you start — get the two inputs

1. **The graph** in **API format** (ComfyUI → Settings → Dev mode →
   "Save (API Format)"). Not the editor `.json` (that one has `nodes`/`links`;
   API format is a flat `{ "<id>": { class_type, inputs, _meta } }` map).
   Ask Damien to paste it if it isn't provided.
2. **What the user should be able to change** (prompt, image, seed, LoRAs,
   dimensions, a threshold…). Each becomes a manifest field patched before
   `POST /prompt`.

## Steps

1. **Create `src/workflows/<id>.ts`** (kebab-case id). Paste the graph into a
   `const graph: PromptGraph = { … }`, exactly as exported — the graph is
   frozen and never mutated directly (patches clone it, see `patch.ts`).

2. **Write the manifest** (`export const <camelId>: WorkflowManifest`):
   - `id` (matches the filename), `icon` (an `Ionicons` glyph name),
   - `name` / `description` → **i18n keys** under `wf.<shortId>.*`
     (e.g. `wf.t2i.name`), never literal English.
   - `saveNodeId`: the `SaveImage` node whose `filename_prefix` is set at
     launch (use `komfy/<id>` as the prefix in the graph). **Omit it** for a
     text-result workflow and instead set `textNodeId` (the `ShowText|pysssss`
     node) — that switches the screen to the result view (no batch/destination).
   - `fields`: one per user-editable input. Pick the kind from
     [types.ts](../../../src/workflows/types.ts):
     `text` · `number` · `seed` · `select` · `dimensions` · `image` ·
     `loras` · `persons`. Each `target` is `{ nodeId, input }` pointing at a
     real node input in the graph. Field `label`/`hint`/`placeholder` and
     `select` option labels are either i18n keys (`wf.common.*`, `wf.<id>.*`)
     or language-neutral literals ("Steps", "euler") that pass through `t()`
     unchanged.

3. **Add the i18n strings** to **both** [src/i18n/en.ts](../../../src/i18n/en.ts)
   (source) **and** [src/i18n/fr.ts](../../../src/i18n/fr.ts), same key paths,
   under the `wf.<shortId>` namespace. Missing fr keys fall back silently to
   English — do not let that happen. Invoke the **`i18n`** skill for parity.

4. **Register it** in [src/workflows/index.ts](../../../src/workflows/index.ts):
   import the manifest and add it to the `workflows` array (order = display
   order in the Workflows grid).

5. **Validate against the real server — never guess.** Every `class_type`,
   every model filename (`unet_name`, `clip_name`, `vae_name`, LoRA names,
   detector names…), and every enum value (`sampler_name`, `scheduler`, the
   `type` on a CLIPLoader…) must exist on the live ComfyUI. Query
   `GET /object_info` (or `GET /object_info/<ClassType>`) on the Tailscale
   instance and diff. If the server is offline, use the **`comfy-server`**
   agent to (re)launch it, then:

   ```bash
   curl -s "http://$(tailscale ip -4):8188/object_info/UNETLoader" | python3 -m json.tool
   ```

   Check custom-node classes too (Impact Pack, comfyui-ollama, Custom-Scripts).

6. **Typecheck** — `npx tsc --noEmit` — and `npm run lint`. Fix before handing off.

## Remix comes for free

A newly embedded workflow is **automatically remixable**: `match.ts` matches
a gallery image's metadata graph to this manifest by structural fingerprint
(class_type + wiring, node IDs may differ) and pre-fills the form. You do NOT
add remix code — but keep the graph's structure faithful to what the server
actually produces, or the fingerprint won't match. `loras` and `persons`
chains are absorbed/restored automatically.

## Finish

Summarize: the new file, the fields exposed, the i18n keys added (en + fr),
the `/object_info` values you verified, and tsc/lint status. **Do not commit** —
end by proposing a commit name via the **`conventional-commit`** skill if useful.
