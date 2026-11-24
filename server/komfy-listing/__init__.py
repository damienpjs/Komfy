"""Komfy — minimal server extension (ComfyUI custom node).

Exposes a recursive, multi-root listing of ComfyUI's image folders
(`output` and `input`) that the core API does not provide
(`/internal/files/{type}` does not descend into subfolders — verified in
the ComfyUI 0.27 source), plus soft-delete (trash), move, rename, mkdir
and trash maintenance used by the Komfy gallery, plus the single-frame
PNG extraction behind the viewer's "save frame" button.

Every path handled by these routes is **prefixed by its root**, e.g.
`output/workflows/x.png` or `input/photo.png`; the first segment selects
the base folder. Moves across roots are allowed (input ↔ output).

No outgoing network calls, no auth: security relies on the Tailscale
network perimeter, like the rest of the ComfyUI API (see the README
§Security).

Install: symlink this folder into custom_nodes/ (see README.md), then
restart ComfyUI.
"""

import asyncio
import io
import json
import os
import shutil
import time
import unicodedata

from aiohttp import web
from PIL import Image, ImageCms

import folder_paths
from server import PromptServer

# "Deletion" = move here (under the file's own root), never a definitive
# rm. Dot-prefixed → invisible in listings. Emptied explicitly from the
# app (Settings → Empty trash). The timestamped layout
# `<root>/.komfy-trash/<YYYYmmdd-HHMMSS>/<original sub path>` keeps each
# file's original location so a future "restore" can move it back.
TRASH_DIRNAME = ".komfy-trash"

# No graph node: this module only registers routes.
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}


def _roots():
    """Known roots → their base directory. `output` is listed first: its
    absence is the "volume not mounted" signal (503)."""
    return {
        "output": folder_paths.get_output_directory(),
        "input": folder_paths.get_input_directory(),
    }


def _split_root(rel):
    """'output/sub/a.png' → ('output', 'sub/a.png'); 'input' → ('input', '')."""
    parts = rel.split("/", 1)
    return parts[0], (parts[1] if len(parts) > 1 else "")


def _within(base_real, path):
    """True if `path`, once symlinks are resolved, stays under `base_real`."""
    try:
        return os.path.realpath(path).startswith(base_real + os.sep)
    except OSError:
        return False


def _safe_target(base_real, rel):
    """Resolves `rel` under `base_real`. Rejects an empty rel (the root
    folder itself is never a valid target), path traversal and the trash.
    Returns (abs_path|None, err)."""
    if rel == "":
        return None, "the root folder itself is not a valid target"
    target = os.path.realpath(os.path.join(base_real, rel))
    if not target.startswith(base_real + os.sep) or TRASH_DIRNAME in rel.split("/"):
        return None, "path outside the root folder"
    return target, None


def list_files_recursive(base, prefix):
    """Contents under `base`, '/'-separated and prefixed with `prefix` (the
    root name):
      - files: {"path", "mtime", "size", "ctime"} — size in bytes and
        creation date (st_birthtime on macOS/BSD; Linux has no birthtime
        via stat, so st_ctime is the best available approximation there);
      - empty folders (no file anywhere in their subtree):
        {"path", "mtime", "dir": True} — the app still shows them in the
        tree (created via /komfy/mkdir, otherwise invisible since the tree
        is derived from file paths).

    `followlinks=True` is required (output/ is itself a symlink to the
    volume), but any file/folder whose symlink would escape `base` is
    discarded — otherwise an internal link would expose arbitrary files.
    """
    base_real = os.path.realpath(base)
    entries = []
    all_dirs = []  # ('/'-separated rel WITHOUT prefix, mtime) of every folder
    for root, dirs, files in os.walk(base, followlinks=True):
        dirs[:] = [
            d
            for d in dirs
            if not d.startswith(".") and _within(base_real, os.path.join(root, d))
        ]
        rel = os.path.relpath(root, base)
        if rel != ".":
            try:
                dmtime = int(os.stat(root).st_mtime)
            except OSError:
                dmtime = 0
            all_dirs.append((rel.replace(os.sep, "/"), dmtime))
        for name in files:
            if name.startswith("."):
                continue
            full = os.path.join(root, name)
            if not _within(base_real, full):
                continue  # symlink pointing outside the root
            try:
                st = os.stat(full)
            except OSError:
                continue  # file gone/unreadable during the walk (e.g. an evicted cloud placeholder)
            path = name if rel == "." else os.path.join(rel, name)
            entries.append(
                {
                    "path": f"{prefix}/{path.replace(os.sep, '/')}",
                    "mtime": int(st.st_mtime),
                    "size": st.st_size,
                    "ctime": int(getattr(st, "st_birthtime", st.st_ctime)),
                }
            )

    # Folders carrying at least one file in their subtree (unprefixed) are
    # already revealed by the file paths above.
    filebearing = set()
    for e in entries:
        parts = e["path"].split("/")[1:-1]  # drop prefix + filename
        for i in range(1, len(parts) + 1):
            filebearing.add("/".join(parts[:i]))
    for path, dmtime in all_dirs:
        if path not in filebearing:
            entries.append({"path": f"{prefix}/{path}", "mtime": dmtime, "dir": True})
    return entries


def move_to_trash(roots, rel_paths):
    """Moves prefixed files/folders to their root's trash. One timestamped
    batch folder per request. Returns (moved, errors by path)."""
    stamp = time.strftime("%Y%m%d-%H%M%S")
    moved, errors = [], {}
    for rel in rel_paths:
        root, sub = _split_root(rel)
        base = roots.get(root)
        if base is None or not os.path.isdir(base):
            errors[rel] = "unknown root"
            continue
        base_real = os.path.realpath(base)
        target, err = _safe_target(base_real, sub)
        if err:
            errors[rel] = err
            continue
        if not os.path.exists(target):
            errors[rel] = "not found"
            continue
        dest = os.path.join(base_real, TRASH_DIRNAME, stamp, sub)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        try:
            shutil.move(target, dest)
            moved.append(rel)
        except OSError as exc:
            errors[rel] = str(exc)
    return moved, errors


def move_paths(roots, rel_paths, dest):
    """Moves prefixed files/folders into `dest` (a prefixed folder, e.g.
    'output/sub' or just 'input' for a root). Source and destination roots
    may differ (input ↔ output). Rejects traversal, the trash, and moving a
    folder into itself/its descendants. Name collisions resolved with a
    " (n)" suffix. Returns (moved, errors)."""
    dest_root, dest_sub = _split_root(dest)
    dest_base = roots.get(dest_root)
    if dest_base is None or not os.path.isdir(dest_base):
        return [], {p: "invalid destination root" for p in rel_paths}
    dest_base_real = os.path.realpath(dest_base)
    if dest_sub:
        dest_abs, err = _safe_target(dest_base_real, dest_sub)
        if err:
            return [], {p: f"invalid destination: {err}" for p in rel_paths}
    else:
        dest_abs = dest_base_real
    if os.path.exists(dest_abs) and not os.path.isdir(dest_abs):
        return [], {p: "destination is not a folder" for p in rel_paths}
    os.makedirs(dest_abs, exist_ok=True)

    moved, errors = [], {}
    for rel in rel_paths:
        root, sub = _split_root(rel)
        base = roots.get(root)
        if base is None or not os.path.isdir(base):
            errors[rel] = "unknown root"
            continue
        base_real = os.path.realpath(base)
        target, err = _safe_target(base_real, sub)
        if err:
            errors[rel] = err
            continue
        if not os.path.exists(target):
            errors[rel] = "not found"
            continue
        # Moving a folder into itself or its descendants would break the tree.
        if os.path.isdir(target) and (
            dest_abs == target or dest_abs.startswith(target + os.sep)
        ):
            errors[rel] = "destination inside the moved folder"
            continue
        name = os.path.basename(target.rstrip(os.sep))
        out = os.path.join(dest_abs, name)
        if os.path.realpath(out) == target:
            errors[rel] = "already in this folder"
            continue
        stem, ext = os.path.splitext(name)
        i = 1
        while os.path.exists(out):
            out = os.path.join(dest_abs, f"{stem} ({i}){ext}")
            i += 1
        try:
            shutil.move(target, out)
            moved.append(rel)
        except OSError as exc:
            errors[rel] = str(exc)
    return moved, errors


def name_problem(name):
    """Why `name` cannot be a single file/folder name, or None when it can.
    A rename never moves: no path separator. A leading dot would hide the
    item from the listings (and is how the trash is named). ':' is refused
    like the app's folder sanitizer does (Finder shows it as '/'). 255
    bytes is the APFS / ext4 limit for one name."""
    if name == "":
        return "empty name"
    if name.startswith("."):
        return "a name cannot start with a dot"
    if any(c in "/\\:" or ord(c) < 32 or ord(c) == 127 for c in name):
        return "a name cannot contain / \\ : or control characters"
    if len(name.encode("utf-8")) > 255:
        return "name too long"
    return None


def _fold(name):
    """Comparison key of a name on a case- and normalization-insensitive
    volume (APFS default): "Café" typed on the phone (NFC) and "café" stored
    decomposed (NFD) are the same entry there."""
    return unicodedata.normalize("NFC", name).casefold()


def _same_entry(a, b):
    """True when both paths are the same file on disk (False if either one
    is missing or a broken link)."""
    try:
        return os.path.samefile(a, b)
    except OSError:
        return False


def rename_path(roots, path, name):
    """Renames a prefixed file/folder in place: `name` replaces the last
    segment of `path`, a folder's contents follow it. Same confinement as
    move_paths (_safe_target: traversal, trash, the bare root). A file keeps
    its extension, otherwise it would drop out of the gallery. No " (n)"
    suffix here, unlike a move: an existing target is an error the user can
    act on. A case-only change ("Foo" → "foo") is allowed on a
    case-insensitive volume, where it is the same entry.

    Returns (renamed_path|None, err, code). `code` is one of "invalid_path",
    "not_found", "invalid_name", "extension", "exists", "os", so the app can
    word the error itself."""
    root, sub = _split_root(path)
    base = roots.get(root)
    if base is None or not os.path.isdir(base):
        return None, "unknown root", "invalid_path"
    base_real = os.path.realpath(base)
    target, err = _safe_target(base_real, sub)
    if err:
        return None, err, "invalid_path"
    if not os.path.exists(target):
        return None, "not found", "not_found"
    name = name.strip()
    problem = name_problem(name)
    if problem:
        return None, problem, "invalid_name"
    old = os.path.basename(target)
    if os.path.isfile(target):
        old_ext = os.path.splitext(old)[1]
        if os.path.splitext(name)[1].lower() != old_ext.lower():
            return None, f"the extension must stay {old_ext or '(none)'}", "extension"
    out = os.path.join(os.path.dirname(target), name)

    def prefixed(abs_path):
        return f"{root}/{os.path.relpath(abs_path, base_real).replace(os.sep, '/')}"

    if name == old:
        return prefixed(target), None, None
    if os.path.lexists(out) and not (
        _fold(name) == _fold(old) and _same_entry(out, target)
    ):
        return None, "an item with this name already exists", "exists"
    # Small race left: os.rename replaces a file created between the check
    # above and this call. Acceptable for a single-user archive.
    try:
        os.rename(target, out)
    except OSError as exc:
        return None, str(exc), "os"
    return prefixed(out), None, None


def make_dir(roots, path):
    """Creates a folder from a prefixed path ('output/sub', 'input/sub').
    Returns (created_path|None, err)."""
    root, sub = _split_root(path)
    base = roots.get(root)
    if base is None or not os.path.isdir(base):
        return None, "unknown root"
    base_real = os.path.realpath(base)
    target, err = _safe_target(base_real, sub)
    if err:
        return None, err
    if os.path.exists(target) and not os.path.isdir(target):
        return None, "a file with the same name already exists"
    try:
        os.makedirs(target, exist_ok=True)
    except OSError as exc:
        return None, str(exc)
    return path, None


def _trash_stats(base):
    """(file count, total bytes) under a root's trash."""
    trash = os.path.join(os.path.realpath(base), TRASH_DIRNAME)
    count = size = 0
    for root, _dirs, files in os.walk(trash):
        for f in files:
            try:
                size += os.path.getsize(os.path.join(root, f))
                count += 1
            except OSError:
                pass
    return count, size


def trash_info(roots):
    """Per-root {"count", "bytes"} of what the trash currently holds."""
    info = {}
    for name, base in roots.items():
        if not os.path.isdir(base):
            continue
        count, size = _trash_stats(base)
        info[name] = {"count": count, "bytes": size}
    return info


def empty_trash(roots, only=None):
    """Permanently removes the trash of every root (or just `only`).
    Returns the freed {"count", "bytes"} per root."""
    freed = {}
    for name, base in roots.items():
        if only and name != only:
            continue
        if not os.path.isdir(base):
            continue
        count, size = _trash_stats(base)
        trash = os.path.join(os.path.realpath(base), TRASH_DIRNAME)
        if os.path.isdir(trash):
            shutil.rmtree(trash, ignore_errors=True)
        freed[name] = {"count": count, "bytes": size}
    return freed


# ComfyUI's LoadImage reads raw pixel values and ignores any embedded ICC
# profile, and SaveImage writes PNGs without one, which every viewer reads
# as sRGB. A Display P3 phone photo therefore comes back desaturated. The
# Komfy upload converts such pictures to sRGB once, on arrival, so the
# models get (and return) the colours the user picked.
_SRGB = ImageCms.createProfile("sRGB")
_SRGB_ICC = ImageCms.ImageCmsProfile(_SRGB).tobytes()


def to_srgb(data):
    """`data` (image file bytes) re-encoded in sRGB, or None when there is
    nothing to do: no ICC profile, already sRGB, not an RGB(A) PNG/JPEG, or
    not readable. Colours outside sRGB are clipped (relative colorimetric),
    everything inside it is preserved. EXIF (orientation) is carried over."""
    try:
        img = Image.open(io.BytesIO(data))
        icc = img.info.get("icc_profile")
        if not icc or img.format not in ("PNG", "JPEG") or img.mode not in ("RGB", "RGBA"):
            return None
        src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        if "srgb" in ImageCms.getProfileDescription(src).lower():
            return None
        fmt, exif = img.format, img.info.get("exif")
        out = ImageCms.profileToProfile(
            img,
            src,
            _SRGB,
            renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
            outputMode=img.mode,
        )
        buf = io.BytesIO()
        extra = {"icc_profile": _SRGB_ICC}
        if exif:
            extra["exif"] = exif
        if fmt == "JPEG":
            out.save(buf, "JPEG", quality=95, subsampling=0, **extra)
        else:
            out.save(buf, "PNG", **extra)
        return buf.getvalue()
    except Exception:
        return None


def save_upload(base, subfolder, filename, data):
    """Writes `data` as `filename` under `base`/`subfolder`, the way core
    /upload/image names files: an identical file already there is reused,
    a different one gets a " (n)" suffix. Returns (name, err)."""
    base_real = os.path.realpath(base)
    folder = os.path.realpath(os.path.join(base_real, subfolder))
    if (folder != base_real and not folder.startswith(base_real + os.sep)) or (
        TRASH_DIRNAME in subfolder.split("/")
    ):
        return None, "subfolder outside the input folder"
    name = os.path.basename(filename)
    if name in ("", ".", "..") or name.startswith("."):
        return None, "invalid filename"
    os.makedirs(folder, exist_ok=True)
    stem, ext = os.path.splitext(name)
    candidate, n = name, 1
    while True:
        path = os.path.join(folder, candidate)
        if not os.path.exists(path):
            with open(path, "wb") as f:
                f.write(data)
            return candidate, None
        if os.path.getsize(path) == len(data):
            with open(path, "rb") as f:
                if f.read() == data:
                    return candidate, None
        candidate = f"{stem} ({n}){ext}"
        n += 1


def _volume_guard():
    """503 response when the output volume is not mounted, else None.
    Keeps the app's existing "volume not mounted" signal (the gallery is
    disabled in that state)."""
    if not os.path.isdir(folder_paths.get_output_directory()):
        return web.json_response(
            {"error": "output directory not found (volume not mounted?)"},
            status=503,
        )
    return None


@PromptServer.instance.routes.get("/komfy/files")
async def komfy_files(request):
    guard = _volume_guard()
    if guard is not None:
        return guard
    entries = []
    for name, base in _roots().items():
        if not os.path.isdir(base):
            continue
        # Always surface the root folder itself (visible even when empty).
        try:
            rmtime = int(os.stat(base).st_mtime)
        except OSError:
            rmtime = 0
        entries.append({"path": name, "mtime": rmtime, "dir": True})
        entries.extend(list_files_recursive(base, name))
    return web.json_response(entries)


@PromptServer.instance.routes.post("/komfy/delete")
async def komfy_delete(request):
    guard = _volume_guard()
    if guard is not None:
        return guard
    try:
        payload = await request.json()
        paths = payload["paths"]
        assert isinstance(paths, list) and paths
        assert all(isinstance(p, str) for p in paths)
    except Exception:
        return web.json_response(
            {"error": 'expected body: {"paths": ["root/relative/path", ...]}'},
            status=400,
        )
    moved, errors = move_to_trash(_roots(), paths)
    return web.json_response({"moved": moved, "errors": errors})


@PromptServer.instance.routes.post("/komfy/move")
async def komfy_move(request):
    guard = _volume_guard()
    if guard is not None:
        return guard
    try:
        payload = await request.json()
        paths = payload["paths"]
        dest = payload["dest"]
        assert isinstance(paths, list) and paths
        assert all(isinstance(p, str) for p in paths)
        assert isinstance(dest, str) and dest
    except Exception:
        return web.json_response(
            {"error": 'expected body: {"paths": [...], "dest": "root/sub"}'},
            status=400,
        )
    moved, errors = move_paths(_roots(), paths, dest)
    return web.json_response({"moved": moved, "errors": errors})


@PromptServer.instance.routes.post("/komfy/rename")
async def komfy_rename(request):
    guard = _volume_guard()
    if guard is not None:
        return guard
    try:
        payload = await request.json()
        path = payload["path"]
        name = payload["name"]
        assert isinstance(path, str) and path
        assert isinstance(name, str)
    except Exception:
        return web.json_response(
            {"error": 'expected body: {"path": "root/sub/item", "name": "new name"}'},
            status=400,
        )
    renamed, err, code = rename_path(_roots(), path, name)
    if err:
        # Never 404 here: the app reads a 404 as "extension missing".
        return web.json_response(
            {"error": err, "code": code}, status=409 if code == "exists" else 400
        )
    return web.json_response({"renamed": renamed})


@PromptServer.instance.routes.post("/komfy/mkdir")
async def komfy_mkdir(request):
    guard = _volume_guard()
    if guard is not None:
        return guard
    try:
        payload = await request.json()
        path = payload["path"]
        assert isinstance(path, str) and path.strip()
    except Exception:
        return web.json_response(
            {"error": 'expected body: {"path": "root/sub/folder"}'},
            status=400,
        )
    created, err = make_dir(_roots(), path)
    if err:
        return web.json_response({"error": err}, status=400)
    return web.json_response({"created": created})


@PromptServer.instance.routes.get("/komfy/trash")
async def komfy_trash_info(request):
    guard = _volume_guard()
    if guard is not None:
        return guard
    return web.json_response(trash_info(_roots()))


@PromptServer.instance.routes.post("/komfy/trash/empty")
async def komfy_trash_empty(request):
    guard = _volume_guard()
    if guard is not None:
        return guard
    only = None
    try:
        payload = await request.json()
        if isinstance(payload, dict) and payload.get("root"):
            only = str(payload["root"])
    except Exception:
        only = None  # no body → empty every root's trash
    return web.json_response({"freed": empty_trash(_roots(), only)})


@PromptServer.instance.routes.post("/komfy/upload/image")
async def komfy_upload_image(request):
    """Drop-in for core POST /upload/image (input folder only): same form
    fields (`image`, optional `subfolder`), same response, plus
    `converted` when the picture was turned into sRGB (cf. to_srgb)."""
    post = await request.post()
    image = post.get("image")
    if image is None or not getattr(image, "filename", None):
        return web.json_response(
            {"error": 'expected multipart fields: "image" (file), "subfolder" (optional)'},
            status=400,
        )
    subfolder = str(post.get("subfolder") or "")
    data = image.file.read()

    def work():
        converted = to_srgb(data)
        name, err = save_upload(
            folder_paths.get_input_directory(),
            subfolder,
            image.filename,
            converted if converted is not None else data,
        )
        return name, err, converted is not None

    # Converting and re-encoding a 12 MP photo takes about a second: keep it
    # off the event loop that also streams the websocket progress.
    name, err, converted = await asyncio.to_thread(work)
    if err:
        return web.json_response({"error": err}, status=400)
    return web.json_response(
        {"name": name, "subfolder": subfolder, "type": "input", "converted": converted}
    )


def read_video_recipe(path):
    """The API graph stored in a video's `prompt` container tag (written by
    ComfyUI's SaveVideo and by the Komfy LTX nodes), or None. PyAV reads the
    tag from the file header without decoding a frame."""
    import av  # ComfyUI dependency, imported lazily: only this route needs it

    try:
        with av.open(path) as container:
            raw = container.metadata.get("prompt")
    except Exception:
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def _frame_at(container, stream, target, seek):
    """Last decoded frame whose presentation time is <= `target` (what a
    player shows at that instant), or the first frame when `target` comes
    before it. `seek` jumps to the keyframe at or before the target first."""
    if seek:
        container.seek(int(target / stream.time_base), stream=stream, backward=True)
    picked = None
    for frame in container.decode(stream):
        if frame.time is None:
            continue
        if frame.time > target:
            # A seek that overshot the target lands past the wanted frame:
            # the caller then retries from the start of the stream.
            return picked if picked is not None or not seek else None
        picked = frame
    return picked


def extract_frame(path, seconds):
    """The frame displayed at `seconds` on the player's timeline, decoded from
    the file itself at its native size, as lossless PNG bytes. Returns
    (png, index, width, height). Nothing is written to disk."""
    import av  # ComfyUI dependency, imported lazily like read_video_recipe
    from av.video.reformatter import Interpolation

    with av.open(path) as container:
        if not container.streams.video:
            raise ValueError("no video stream in this file")
        stream = container.streams.video[0]
        stream.thread_type = "AUTO"
        start = float(stream.start_time * stream.time_base) if stream.start_time else 0.0
        # The app sends the middle of a frame; the margin only absorbs float
        # noise for a caller that sends a frame's exact start.
        target = start + seconds + 1e-4
        frame = _frame_at(container, stream, target, seek=seconds > 0)
        if frame is None:
            container.seek(0)
            frame = _frame_at(container, stream, target, seek=False)
        if frame is None:
            raise ValueError("no decodable frame")
        rate = stream.average_rate or stream.guessed_rate
        index = round((frame.time - start) * float(rate)) if rate else None
        # Colorspace and range follow the file's tags (BT.601 when untagged,
        # as the encoders that wrote it assumed): same colors as the player.
        rgb = frame.reformat(
            format="rgb24",
            interpolation=Interpolation.BICUBIC
            | Interpolation.ACCURATE_RND
            | Interpolation.FULL_CHR_H_INT,
        ).to_ndarray()
    image = Image.fromarray(rgb)
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue(), index, image.width, image.height


@PromptServer.instance.routes.get("/komfy/frame")
async def komfy_frame(request):
    """GET /komfy/frame?path=output/sub/clip.mp4&t=3.6458 → image/png: the
    exact frame shown at `t` seconds, native resolution, lossless. Built in
    memory and streamed back, never stored on the server. Headers carry the
    frame index and size. Errors are 400 (never 404: the app reads a 404 as
    "extension older than the route")."""
    rel = request.query.get("path", "")
    try:
        seconds = float(request.query.get("t", ""))
        assert seconds >= 0 and seconds == seconds  # rejects NaN
    except (ValueError, AssertionError):
        return web.json_response({"error": "expected ?t=<seconds >= 0>"}, status=400)
    root, sub = _split_root(rel)
    base = _roots().get(root)
    if base is None:
        return web.json_response({"error": "unknown root"}, status=400)
    target, err = _safe_target(os.path.realpath(base), sub)
    if err or not os.path.isfile(target):
        return web.json_response({"error": err or "file not found"}, status=400)
    try:
        png, index, width, height = await asyncio.to_thread(extract_frame, target, seconds)
    except Exception as e:
        return web.json_response({"error": f"could not decode the frame: {e}"}, status=400)
    headers = {
        "Cache-Control": "no-store",
        "X-Komfy-Frame-Size": f"{width}x{height}",
    }
    if index is not None:
        headers["X-Komfy-Frame-Index"] = str(index)
    return web.Response(body=png, content_type="image/png", headers=headers)


def thumbnail(path, height):
    """The clip's first frame, `height` px high, as JPEG bytes: a gallery or
    picker tile. Decodes one frame (no seek, no count), so a grid of dozens
    of clips stays cheap."""
    import av

    with av.open(path) as container:
        stream = _video_stream(container)
        for frame in container.decode(stream):
            width = max(2, int(round(frame.width * height / frame.height / 2)) * 2)
            rgb = frame.reformat(width=width, height=height, format="rgb24").to_ndarray()
            break
        else:
            raise ValueError("no decodable frame")
    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, format="JPEG", quality=82)
    return buf.getvalue()


@PromptServer.instance.routes.get("/komfy/thumb")
async def komfy_thumb(request):
    """GET /komfy/thumb?path=output/sub/clip.mp4&height=320 → image/jpeg: the
    clip's first frame, for the video tiles of the gallery and the video
    picker (the app versions the URL with the file's mtime). Errors are 400
    like /komfy/frame."""
    target, err = _video_target(request.query.get("path", ""))
    if err:
        return web.json_response({"error": err}, status=400)
    try:
        height = int(request.query.get("height", "320"))
        assert 16 <= height <= 720
    except (ValueError, AssertionError):
        return web.json_response({"error": "expected height 16..720"}, status=400)
    try:
        jpeg = await asyncio.to_thread(thumbnail, target, height)
    except Exception as e:
        return web.json_response({"error": f"could not decode the clip: {e}"}, status=400)
    return web.Response(body=jpeg, content_type="image/jpeg")


def _video_target(rel):
    """`output/sub/clip.mp4` → (absolute path, None) or (None, error)."""
    root, sub = _split_root(rel)
    base = _roots().get(root)
    if base is None:
        return None, "unknown root"
    target, err = _safe_target(os.path.realpath(base), sub)
    if err or not os.path.isfile(target):
        return None, err or "file not found"
    return target, None


def _annotated_target(name):
    """Annotated filename of a form image (`a.png` = input folder,
    `sub/a.png [output]` = a gallery picture sent by "Use in") → (absolute
    path, None) or (None, error)."""
    root = "input"
    for candidate in ("input", "output"):
        suffix = f" [{candidate}]"
        if name.endswith(suffix):
            name, root = name[: -len(suffix)], candidate
            break
    return _video_target(f"{root}/{name}")


def _video_stream(container):
    if not container.streams.video:
        raise ValueError("no video stream in this file")
    stream = container.streams.video[0]
    stream.thread_type = "AUTO"
    return stream


def _small_size(width, height, long_side):
    """Thumbnail size keeping the ratio, even sides (swscale likes them)."""
    scale = long_side / max(width, height)
    return max(2, int(round(width * scale / 2)) * 2), max(2, int(round(height * scale / 2)) * 2)


def _count_frames(path):
    """Exact decoded frame count (container metadata can be off by one)."""
    import av

    with av.open(path) as container:
        return sum(1 for _ in container.decode(_video_stream(container)))


def filmstrip(path, count, height):
    """`count` frames evenly spread over the clip (first and last included),
    `height` px high, side by side in one JPEG. Decodes in order (no seek:
    exact frames) and keeps only the picked frames, so a long clip costs
    decode time, not memory. Returns (jpeg, frame count, fps, width, height
    of the source)."""
    import av

    total = _count_frames(path)
    if total == 0:
        raise ValueError("no decodable frame")
    count = max(1, min(count, total))
    picks = [round(i * (total - 1) / max(1, count - 1)) for i in range(count)]
    wanted = set(picks)
    kept = {}
    with av.open(path) as container:
        stream = _video_stream(container)
        rate = stream.average_rate or stream.guessed_rate
        src_w, src_h = stream.codec_context.width, stream.codec_context.height
        tile_w = max(2, int(round(src_w * height / src_h / 2)) * 2)
        for index, frame in enumerate(container.decode(stream)):
            if index in wanted:
                kept[index] = frame.reformat(width=tile_w, height=height, format="rgb24").to_ndarray()
    sheet = Image.new("RGB", (tile_w * count, height))
    for slot, index in enumerate(picks):
        if index in kept:
            sheet.paste(Image.fromarray(kept[index]), (slot * tile_w, 0))
    buf = io.BytesIO()
    sheet.save(buf, format="JPEG", quality=80)
    return buf.getvalue(), total, float(rate) if rate else None, src_w, src_h


def match_frame(video, image_path):
    """Index of the clip frame closest to a picture (mean absolute gray-level
    difference on small thumbnails). Built for a frame grabbed from this clip
    and retouched (a face swapped): the untouched rest of the picture still
    matches its own frame almost pixel for pixel. Returns (index, distance in
    0..1, runner-up distance, frame count, fps)."""
    import av
    import numpy as np

    with av.open(video) as container:
        stream = _video_stream(container)
        rate = stream.average_rate or stream.guessed_rate
        w, h = _small_size(stream.codec_context.width, stream.codec_context.height, 96)
        with Image.open(image_path) as img:
            from PIL import ImageOps

            probe = np.asarray(
                ImageOps.exif_transpose(img).convert("L").resize((w, h), Image.BILINEAR),
                dtype=np.float32,
            )
        distances = []
        for frame in container.decode(stream):
            gray = frame.reformat(width=w, height=h, format="gray").to_ndarray().astype(np.float32)
            distances.append(float(np.abs(gray - probe).mean()) / 255.0)
    if not distances:
        raise ValueError("no decodable frame")
    best = int(np.argmin(distances))
    # The best frame outside the best one's neighbourhood: a static shot has
    # near-twins around the match, which say nothing about ambiguity.
    far = [d for i, d in enumerate(distances) if abs(i - best) > 4]
    runner_up = min(far) if far else None
    return best, distances[best], runner_up, len(distances), float(rate) if rate else None


@PromptServer.instance.routes.get("/komfy/filmstrip")
async def komfy_filmstrip(request):
    """GET /komfy/filmstrip?path=output/sub/clip.mp4&count=12&height=96 →
    image/jpeg: `count` frames of the clip side by side (the keyframe
    timeline's background). Headers carry the frame count, frame rate and
    source size. Errors are 400 like /komfy/frame."""
    target, err = _video_target(request.query.get("path", ""))
    if err:
        return web.json_response({"error": err}, status=400)
    try:
        count = int(request.query.get("count", "12"))
        height = int(request.query.get("height", "96"))
        assert 1 <= count <= 48 and 16 <= height <= 360
    except (ValueError, AssertionError):
        return web.json_response({"error": "expected count 1..48 and height 16..360"}, status=400)
    try:
        jpeg, frames, fps, width, src_h = await asyncio.to_thread(filmstrip, target, count, height)
    except Exception as e:
        return web.json_response({"error": f"could not decode the clip: {e}"}, status=400)
    headers = {"X-Komfy-Frames": str(frames), "X-Komfy-Frame-Size": f"{width}x{src_h}"}
    if fps:
        headers["X-Komfy-Fps"] = f"{fps:g}"
    return web.Response(body=jpeg, content_type="image/jpeg", headers=headers)


@PromptServer.instance.routes.get("/komfy/video-info")
async def komfy_video_info(request):
    """GET /komfy/video-info?path=output/sub/clip.mp4 → {frames, fps, width,
    height, mtime}: the exact decoded frame count (what keyframe numbers refer to),
    read by decoding the clip, since container metadata can be off by one."""
    target, err = _video_target(request.query.get("path", ""))
    if err:
        return web.json_response({"error": err}, status=400)

    def work():
        import av

        with av.open(target) as container:
            stream = _video_stream(container)
            rate = stream.average_rate or stream.guessed_rate
            frames = sum(1 for _ in container.decode(stream))
            return {
                "frames": frames,
                "fps": float(rate) if rate else None,
                "width": stream.codec_context.width,
                "height": stream.codec_context.height,
                # Versions the app's filmstrip and frame URLs: a clip
                # regenerated at the same path must not show cached frames.
                "mtime": int(os.path.getmtime(target)),
            }

    try:
        info = await asyncio.to_thread(work)
    except Exception as e:
        return web.json_response({"error": f"could not decode the clip: {e}"}, status=400)
    return web.json_response(info)


@PromptServer.instance.routes.get("/komfy/frame-match")
async def komfy_frame_match(request):
    """GET /komfy/frame-match?video=output/sub/clip.mp4&image=a.png →
    {frame, distance, runnerUp, frames, fps}: where a picture taken from the
    clip (then retouched) sits in it. `image` is a form value: an input-folder
    name, or `sub/a.png [output]`. `distance` is 0 for an identical frame; a
    `runnerUp` close to it means the shot barely moves around the match."""
    video, err = _video_target(request.query.get("video", ""))
    if err:
        return web.json_response({"error": f"video: {err}"}, status=400)
    image, err = _annotated_target(request.query.get("image", ""))
    if err:
        return web.json_response({"error": f"image: {err}"}, status=400)
    try:
        index, distance, runner_up, frames, fps = await asyncio.to_thread(match_frame, video, image)
    except Exception as e:
        return web.json_response({"error": f"could not match the frame: {e}"}, status=400)
    return web.json_response({
        "frame": index,
        "distance": round(distance, 5),
        "runnerUp": None if runner_up is None else round(runner_up, 5),
        "frames": frames,
        "fps": fps,
    })


@PromptServer.instance.routes.get("/komfy/recipe")
async def komfy_recipe(request):
    """GET /komfy/recipe?path=output/sub/clip.mp4 → {"prompt": graph|null}.
    Lets the app remix a video without downloading it: the recipe lives in
    the file, so it survives a server restart (unlike /history)."""
    rel = request.query.get("path", "")
    root, sub = _split_root(rel)
    base = _roots().get(root)
    if base is None:
        return web.json_response({"error": "unknown root"}, status=400)
    target, err = _safe_target(os.path.realpath(base), sub)
    if err or not os.path.isfile(target):
        return web.json_response({"error": err or "file not found"}, status=404)
    graph = await asyncio.to_thread(read_video_recipe, target)
    return web.json_response({"prompt": graph})
