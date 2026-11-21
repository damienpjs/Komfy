"""Reference sheet for the LTX "Ingredients" IC-LoRA (2.3 and 2.5).

Lightricks trained the Ingredients IC-LoRA on a single composite image that
inventories the scene: one clean panel per element on a black background, no
text, at the resolution of the generated video. It is fed as a static video
(the sheet repeated over every frame), which the model reads as in-context
tokens beside the frames it generates.

Komfy builds that sheet from 1 to 3 photos (a face close-up, a full-body
shot, a profile...). Each photo keeps its aspect ratio and is fitted into
one cell; the grid (rows x columns) is the one that gives the photos the
largest total area on the canvas, since larger panels carry over more
faithfully (model card).
"""

import math

import numpy as np
from PIL import Image

# Black gutter around and between the panels, as a fraction of the short side.
GUTTER = 0.02


def _layouts(count):
    for rows in range(1, count + 1):
        yield rows, math.ceil(count / rows)


def _fit(img_w, img_h, cell_w, cell_h):
    scale = min(cell_w / img_w, cell_h / img_h)
    return max(1, int(img_w * scale)), max(1, int(img_h * scale))


def _trim_black(img, threshold=12):
    """Crops the near-black margins of a cut-out (subject on black), so the
    subject, not its empty border, fills the panel. Photos with no such
    margin come back unchanged."""
    lit = img[:, :, :3].max(axis=2) > threshold
    rows, cols = np.flatnonzero(lit.any(axis=1)), np.flatnonzero(lit.any(axis=0))
    if rows.size == 0 or cols.size == 0:
        return img
    return img[rows[0]:rows[-1] + 1, cols[0]:cols[-1] + 1]


def build_sheet(images, width, height):
    """images: list of HxWx3 uint8 arrays. Returns an HxWx3 uint8 sheet of
    exactly width x height."""
    if not images:
        raise ValueError("A reference sheet needs at least one image")
    images = [_trim_black(img) for img in images]
    gutter = max(2, int(round(min(width, height) * GUTTER)))

    best = None
    for rows, cols in _layouts(len(images)):
        cell_w = (width - gutter * (cols + 1)) / cols
        cell_h = (height - gutter * (rows + 1)) / rows
        if cell_w < 8 or cell_h < 8:
            continue
        area = 0
        for img in images:
            w, h = _fit(img.shape[1], img.shape[0], cell_w, cell_h)
            area += w * h
        if best is None or area > best[0]:
            best = (area, rows, cols, cell_w, cell_h)
    _, rows, cols, cell_w, cell_h = best

    sheet = Image.new("RGB", (width, height), (0, 0, 0))
    for i, img in enumerate(images):
        row, col = divmod(i, cols)
        # The last row may hold fewer panels: centre them.
        in_row = min(cols, len(images) - row * cols)
        row_offset = (cols - in_row) * (cell_w + gutter) / 2
        w, h = _fit(img.shape[1], img.shape[0], cell_w, cell_h)
        x0 = gutter + row_offset + col * (cell_w + gutter) + (cell_w - w) / 2
        y0 = gutter + row * (cell_h + gutter) + (cell_h - h) / 2
        panel = Image.fromarray(img[:, :, :3]).resize((w, h), Image.LANCZOS)
        sheet.paste(panel, (int(round(x0)), int(round(y0))))
    return np.asarray(sheet)


def tensor_to_uint8(image_tensor):
    """First frame of a ComfyUI IMAGE batch (B,H,W,C float 0-1) as uint8."""
    arr = image_tensor[0].cpu().numpy()
    return np.clip(arr * 255.0, 0, 255).astype(np.uint8)

