"""Komfy — minimal server extension (ComfyUI custom node).

Exposes a recursive, multi-root listing of ComfyUI's image folders
(`output` and `input`) that the core API does not provide
(`/internal/files/{type}` does not descend into subfolders — verified in
the ComfyUI 0.27 source), plus soft-delete (trash), move, mkdir and
trash maintenance used by the Komfy gallery.

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
import os
import shutil
import time

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
