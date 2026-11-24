# komfy-listing — server extension for Komfy

Multi-root file manager for the Komfy gallery. It exposes ComfyUI's two
image roots — **`output`** and **`input`** — as a single browsable tree.
Every path is **prefixed by its root** (e.g. `output/sub/img_00001_.png`,
`input/photo.png`); the first segment selects the base folder, and moves
across roots are allowed (input ↔ output).

Routes:

- `GET /komfy/files`: recursive listing of both roots
  (`[{"path": "output/2026-07-09/img_00001_.png", "mtime": 1783700000, "size": 1994237, "ctime": 1783700000}, …]`;
  `size` in bytes, `ctime` = creation date (`st_birthtime` where available,
  `st_ctime` otherwise).
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
- `POST /komfy/rename` (`{"path": "output/sub/old.png", "name": "new.png"}`):
  renames a file or folder in place (a folder's contents follow).
  Returns `{"renamed": "output/sub/new.png"}`. Refused, with
  `{"error", "code"}`: an invalid name (`400`, `invalid_name`: empty,
  leading dot, `/ \ :` or control characters, over 255 bytes), a file
  extension change (`400`, `extension`), an existing target (`409`,
  `exists`, no " (n)" suffix here), a missing item (`400`, `not_found`),
  the bare root, traversal or the trash (`400`, `invalid_path`). A
  case-only change is allowed.
- `POST /komfy/mkdir` (`{"path": "input/sub"}`): creates a folder
  (recursive, `exist_ok`). Traversal and trash rejected.
- `GET /komfy/trash`: per-root `{count, bytes}` of what the trash holds.
- `POST /komfy/trash/empty` (`{}` or `{"root": "input"}`): permanently
  removes the trash of every root (or just `root`). Returns the freed
  `{count, bytes}` per root. **Irreversible.**
- `POST /komfy/upload/image` (multipart `image`, optional `subfolder`):
  drop-in for core `/upload/image`, input folder only, same naming
  (identical file reused, otherwise a " (n)" suffix). A PNG or JPEG whose
  ICC profile is not sRGB (an iPhone photo is Display P3) is converted to
  sRGB on arrival, because `LoadImage` ignores profiles and `SaveImage`
  writes none: without it the result comes back desaturated. Colours
  outside sRGB are clipped. Response adds `"converted": true|false`. The
  app falls back to the core route on 404.
- `GET /komfy/frame?path=output/sub/clip.mp4&t=3.6458`: the frame a
  player shows at `t` seconds (the last one whose presentation time is
  `<= t`), decoded with PyAV from the file itself at its native size and
  returned as lossless PNG (`image/png`). Built in memory, never written
  to disk. Headers: `X-Komfy-Frame-Index` (0-based) and
  `X-Komfy-Frame-Size` (`WxH`). Colours follow the file's tags, BT.601
  when untagged, as the encoders that wrote it assumed. Errors are `400`
  with `{"error"}`, never `404`, which the app reads as "extension older
  than the route". Used by the viewer's "save frame" button.
- `GET /komfy/filmstrip?path=output/sub/clip.mp4&count=12&height=96`:
  `count` frames (1 to 48) spread evenly over the clip, first and last
  included, `height` px high (16 to 360), side by side in one JPEG. The
  clip is decoded in order (exact frames, no seek), keeping only the picked
  frames, so a long clip costs decode time, not memory. Headers:
  `X-Komfy-Frames`, `X-Komfy-Fps`, `X-Komfy-Frame-Size`. The background of
  the keyframes timeline.
- `GET /komfy/thumb?path=output/sub/clip.mp4&height=480`: the clip's first
  frame, `height` px high (16 to 720), as JPEG. Decodes a single frame
  (about 15 ms for a 576×768 clip, 14 KB at 320 px), so a grid of dozens
  of clips stays cheap. The video tiles of the gallery and of the in-app
  picker; the app versions the URL with the file's mtime. Same `400`
  errors as above.
- `GET /komfy/video-info?path=output/sub/clip.mp4`: `{frames, fps, width,
  height, mtime}`, `frames` counted by decoding the clip (what the viewer's
  frame numbers refer to), since container metadata can be off by one.
  `mtime` versions the app's filmstrip and frame URLs (`&v=`, ignored by
  the server) so a clip regenerated at the same path is not served cached.
- `GET /komfy/frame-match?video=output/sub/clip.mp4&image=a.png`:
  `{frame, distance, runnerUp, frames, fps}`, the frame of the clip closest
  to a picture (mean absolute gray-level difference on 96 px thumbnails,
  `distance` in 0..1). `image` is a form value: an input-folder name or
  `sub/a.png [output]`. Built for a frame grabbed from the clip then
  retouched (a face swapped): the untouched rest still matches its own
  frame. Measured: a frame grabbed at 37 with its face painted over came
  back as 37, in 0.13 s for a 121-frame clip. `runnerUp` is the best distance more than 4 frames away: close
  to `distance`, the shot barely moves there. Same `400` errors as above.

`503` on all routes except the upload when the output folder is
unavailable.

The core ComfyUI API only lists the first level of output; these routes
let the Komfy gallery browse both archives, upload into input and clean
them up. The only definitive delete is the explicit "empty trash"; all
other writes are soft (trash only). No outgoing call, no authentication:
security is the Tailscale perimeter (README §Security). The app
automatically falls back to the session history when the routes are
absent (extension not installed or ComfyUI not yet restarted).

## Install

```bash
# macOS / Linux
ln -s "<Komfy repo>/server/komfy-listing" <comfy-data-dir>/custom_nodes/komfy-listing
```
```powershell
# Windows (PowerShell, Developer Mode or admin)
New-Item -ItemType SymbolicLink `
  -Path <comfy-data-dir>\custom_nodes\komfy-listing `
  -Target "<Komfy repo>\server\komfy-listing"
```

Then restart ComfyUI (if you run several instances sharing the same
`custom_nodes` folder, restart each).

⚠️ If the repo lives on a cloud-synced volume (e.g. iCloud Drive) and a file
gets evicted locally, the import will fail at ComfyUI startup (without
bringing the server down).
