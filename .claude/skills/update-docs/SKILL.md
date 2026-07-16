---
name: update-docs
description: Use after a change that alters user-facing setup, code structure, workflows, endpoints, dependencies, or roadmap status, to bring the docs back in sync — README.md (structure, workflow list, setup, security), ROADMAP.md (sprint checkboxes / decisions), and docs/api-notes.md (real API responses, the source of truth for the TS types). Triggers on "update the readme", "update docs", "mets à jour la doc", new workflow/dependency/endpoint.
---

You are Komfy's documentation updater. After code changes land in the working
tree, you detect which docs drifted and update **only** what actually changed —
faithfully, no invented status. **No git** (CLAUDE.md); leave edits for Damien.

## The three docs and when each drifts

- **[README.md](../../../README.md)** — the human-facing guide. Update when:
  - a **workflow** was added/removed → the "Adding a workflow" example still
    valid? (the Structure block lists `src/workflows/` generically, but check
    prose that names specific workflows);
  - the **Structure** tree (README §Structure) no longer matches `src/` —
    a new top-level folder (`src/hooks`, `src/store`, …) or a moved file;
  - **setup** changed — new prerequisite (custom node, model, Ollama alias),
    a changed launch flag, a new npm script in `package.json`;
  - **security** posture changed (new endpoint, new network surface).
- **[ROADMAP.md](../../../ROADMAP.md)** — sprint tracker. Update when a
  roadmap task is now done/undone: flip `- [ ]` ↔ `- [x]`, or append to
  "Frozen decisions" / "Out of MVP scope". Keep the historical annotations
  (dates, "amended post-MVP…") — don't rewrite history, add to it.
- **[docs/api-notes.md](../../../docs/api-notes.md)** — **source of truth for
  the TS types** (CLAUDE.md: "do not code the client on assumptions"). Update
  when you relied on a real endpoint response: paste the actual JSON/shape
  observed from the live server, not an assumed one.

## Procedure

1. See what changed: `git status --short`, `git diff` (read-only git only).
2. Map each change to the doc(s) it affects using the table above. If nothing
   user-facing changed (pure internal refactor, tests), say so and stop —
   don't manufacture edits.
3. For a **structure** update, regenerate the tree from reality:

   ```bash
   find src -maxdepth 2 -type d | sort
   ```

   and reconcile it with the README §Structure block (keep the one-line
   comments; match the existing style — this is a curated tree, not raw
   `tree` output).
4. For an **api-notes** update, capture the real response — launch the server
   via the **`comfy-server`** agent if it's offline, then e.g.
   `curl -s "http://$(tailscale ip -4):8188/queue" | python3 -m json.tool` —
   and record the observed shape. Never guess a response.
5. Keep both languages of intent consistent: README/ROADMAP prose is English
   (project default). UI strings are **not** touched here — use the **`i18n`**
   skill for those.

## Finish

List which docs you edited and which you deliberately left alone (and why).
Do not commit; offer a commit name via **`conventional-commit`** if useful.
