# komfy-listing — server extension for Komfy

Multi-root file manager for the Komfy gallery. It exposes ComfyUI's two
image roots — **`output`** and **`input`** — as a single browsable tree.
Every path is **prefixed by its root** (e.g. `output/sub/img_00001_.png`,
`input/photo.png`); the first segment selects the base folder, and moves
across roots are allowed (input ↔ output).

Routes:

- `GET /komfy/files`: recursive listing of both roots
  (`[{"path": "output/2026-07-09/img_00001_.png", "mtime": 1783700000}, …]`).
  The bare root names (`output`, `input`) and **empty folders** (no file
  anywhere in their subtree) are also returned with `"dir": true`, so they
  stay visible in the app (otherwise the tree, derived from file paths,
  would not show them);
- `POST /komfy/delete` (`{"paths": ["output/relative/path", …]}`):
  "deletion" of files/folders = **move to
  `<root>/.komfy-trash/<timestamp>/<original sub path>`** (never a
  definitive rm). The timestamped layout keeps each file's original
  location so a future "restore" can move it back. Paths outside a root or
  targeting the trash are rejected.
- `POST /komfy/move` (`{"paths": [...], "dest": "output/sub"}`): moves
  files/folders into `dest` (a prefixed folder, or just `input`/`output`
  for a root). Source and destination roots may differ. Traversal and
  trash rejected, moving a folder into itself rejected, name collisions
  resolved with a " (n)" suffix. `dest` created as needed.
- `POST /komfy/mkdir` (`{"path": "input/sub"}`): creates a folder
  (recursive, `exist_ok`). Traversal and trash rejected.
- `GET /komfy/trash`: per-root `{count, bytes}` of what the trash holds.
- `POST /komfy/trash/empty` (`{}` or `{"root": "input"}`): permanently
  removes the trash of every root (or just `root`). Returns the freed
  `{count, bytes}` per root. **Irreversible.**

`503` on all routes when the output volume is not mounted.

The core ComfyUI API only lists the first level of output; these routes
let the Komfy gallery browse both archives, upload into input and clean
them up. The only definitive delete is the explicit "empty trash"; all
other writes are soft (trash only). No outgoing call, no authentication:
security is the Tailscale perimeter (README §Security). The app
automatically falls back to the session history when the routes are
absent (extension not installed or ComfyUI not yet restarted).

## Install

```bash
ln -s "<Komfy repo>/server/komfy-listing" ~/Documents/ComfyUI/custom_nodes/komfy-listing
```

Then restart ComfyUI (both instances — Desktop and Tailscale — share the
same `custom_nodes` folder).

⚠️ If the repo lives on iCloud Drive and the file gets evicted locally,
the import will fail at ComfyUI startup (without bringing the server
down).
