/**
 * Rasterizes the finger-drawn inpaint strokes into an 8-bit mask.
 *
 * Strokes are stored resolution-independently (points in normalized image
 * space 0..1, radius as a fraction of the image's long side), so the same
 * stroke list renders the on-screen preview, a zoomed-in close-up of part of
 * the image, and the full-size mask uploaded to ComfyUI.
 *
 * Each segment is stamped as a capsule (the set of pixels within `radius`
 * of the segment) rather than a run of discs: no overdraw seams, and the
 * 1-pixel soft edge falls out of the distance test for free, which matters
 * because a hard-edged mask is exactly what makes an inpaint seam visible.
 *
 * A stroke is one shape: its capsules are merged into a coverage buffer
 * (max), and only then applied to the mask, raising it (paint) or scaling
 * it down (erase). Applying an eraser capsule by capsule would multiply the
 * feathered edge down once per overlapping segment and leave the eraser
 * with a hard edge the brush does not have.
 *
 * Painting is incremental (`MaskLayer`): the editor stamps only the points a
 * finger move added, so the cost of a refresh no longer grows with
 * everything drawn before it.
 */

import { encodePng } from './png';

export interface MaskPoint {
  /** 0..1, left → right. */
  x: number;
  /** 0..1, top → bottom. */
  y: number;
}

export interface MaskStroke {
  points: MaskPoint[];
  /** Brush radius as a fraction of the image's long side (0..1). */
  radius: number;
  /** true = erase what previous strokes painted. */
  erase: boolean;
}

/** Part of the image a raster covers, in normalized image coordinates. */
export interface RasterWindow {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_WINDOW: RasterWindow = { x: 0, y: 0, w: 1, h: 1 };

/** Inclusive pixel rectangle. */
interface PixelRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** true when both stroke lists hold the very same strokes, in order. */
export function sameStrokes(a: MaskStroke[], b: MaskStroke[]): boolean {
  return a.length === b.length && a.every((stroke, i) => stroke === b[i]);
}

/**
 * A mask raster over `window` of the image, painted stroke by stroke.
 *
 * `mask` always holds the committed strokes composited with the live one:
 * it is what gets displayed or uploaded. The live stroke can grow point by
 * point (`extend`), then be committed or dropped.
 */
export class MaskLayer {
  readonly width: number;
  readonly height: number;
  readonly window: RasterWindow;
  /** Committed strokes + the live one (0 = untouched, 255 = masked). */
  readonly mask: Uint8Array;
  /** Committed strokes only. */
  private readonly base: Uint8Array;
  /** Coverage of the live stroke alone. */
  private readonly cov: Uint8Array;
  /** Raster pixels per normalized unit, horizontally and vertically. */
  private readonly sx: number;
  private readonly sy: number;

  private live: MaskStroke | null = null;
  /** Index of the next live point to stamp. */
  private next = 0;
  /** Pixels the live stroke has touched so far. */
  private dirty: PixelRect | null = null;
  /** true when `mask` lags behind `cov` over `dirty` (batched painting). */
  private stale = false;

  constructor(width: number, height: number, window = FULL_WINDOW) {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.window = window;
    const size = this.width * this.height;
    this.mask = new Uint8Array(size);
    this.base = new Uint8Array(size);
    this.cov = new Uint8Array(size);
    this.sx = this.width / window.w;
    this.sy = this.height / window.h;
  }

  /** Re-renders the committed strokes from scratch (drops any live one). */
  reset(strokes: MaskStroke[]): void {
    this.live = null;
    this.dirty = null;
    this.mask.fill(0);
    this.base.fill(0);
    this.cov.fill(0);
    for (const stroke of strokes) {
      this.begin(stroke);
      // Nobody looks at the mask until the stroke is done: composite once
      // over the stroke instead of once per overlapping segment.
      this.extend(Infinity, false);
      this.commit();
    }
  }

  /** Starts painting `stroke`; its points are read again on each `extend`. */
  begin(stroke: MaskStroke): void {
    if (this.live) this.cancel();
    this.live = stroke;
    this.next = 0;
    this.dirty = null;
    this.stale = false;
  }

  get painting(): boolean {
    return this.live != null;
  }

  /** false while the live stroke has not reached a single pixel. */
  get touched(): boolean {
    return this.dirty != null;
  }

  /**
   * Stamps the live stroke's points added since the last call (at most
   * `maxPoints` of them). Returns false once every point is stamped.
   * With `composite` false, `mask` is only brought up to date on commit:
   * same result, less work, for a stroke nobody watches being drawn.
   */
  extend(maxPoints = Infinity, composite = true): boolean {
    const stroke = this.live;
    if (!stroke) return false;
    const { points } = stroke;
    const end = Math.min(points.length, this.next + maxPoints);
    if (this.next >= end) return this.next < points.length;

    const { x: wx, y: wy } = this.window;
    const { sx, sy } = this;
    // Sub-pixel radii would vanish on a small raster; keep the brush visible
    // at every resolution.
    const radius = Math.max(0.5, stroke.radius * Math.max(sx, sy));
    for (let i = this.next; i < end; i++) {
      const b = points[i];
      // The first point is a dot, so a tap paints too; every later point
      // closes a segment. The dot sits inside the first capsule, and stroke
      // coverage is a max, so it never shows twice.
      const a = i === 0 ? b : points[i - 1];
      const rect = this.stampCapsule(
        (a.x - wx) * sx,
        (a.y - wy) * sy,
        (b.x - wx) * sx,
        (b.y - wy) * sy,
        radius,
      );
      if (rect) {
        if (composite) this.composite(rect, stroke.erase);
        else this.stale = true;
        this.dirty = this.dirty ? unionRect(this.dirty, rect) : rect;
      }
    }
    this.next = end;
    return end < points.length;
  }

  /** Bakes the live stroke into the committed strokes. */
  commit(): void {
    const rect = this.dirty;
    if (rect) {
      if (this.stale && this.live) this.composite(rect, this.live.erase);
      this.copyRect(this.mask, this.base, rect);
      this.clearRect(this.cov, rect);
    }
    this.live = null;
    this.dirty = null;
    this.stale = false;
  }

  /** Drops the live stroke, restoring the committed mask under it. */
  cancel(): void {
    const rect = this.dirty;
    if (rect) {
      this.copyRect(this.base, this.mask, rect);
      this.clearRect(this.cov, rect);
    }
    this.live = null;
    this.dirty = null;
    this.stale = false;
  }

  /**
   * Raises the live stroke's coverage with one capsule. Returns the pixels
   * it could reach, or null when it misses the raster entirely.
   */
  private stampCapsule(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    radius: number,
  ): PixelRect | null {
    const { width, height, cov } = this;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx) - radius - 1));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + radius + 1));
    const minY = Math.max(0, Math.floor(Math.min(ay, by) - radius - 1));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by) + radius + 1));
    if (minX > maxX || minY > maxY) return null;

    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const invLengthSq = lengthSq === 0 ? 0 : 1 / lengthSq;
    // Coverage ramps over the last pixel of the radius (the soft edge):
    // 1 inside `inner`, 0 beyond `outer`, a square root only in between.
    const outer = radius + 0.5;
    const outerSq = outer * outer;
    const inner = radius - 0.5;
    const innerSq = inner > 0 ? inner * inner : -1;

    for (let y = minY; y <= maxY; y++) {
      const row = y * width;
      const qy = y + 0.5 - ay;
      for (let x = minX; x <= maxX; x++) {
        const i = row + x;
        if (cov[i] === 255) continue;
        const qx = x + 0.5 - ax;
        // Closest point of the segment (a degenerate one is a plain disc).
        let t = (qx * dx + qy * dy) * invLengthSq;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = qx - t * dx;
        const ey = qy - t * dy;
        const dSq = ex * ex + ey * ey;
        if (dSq >= outerSq) continue;
        const value =
          dSq <= innerSq ? 255 : Math.round((outer - Math.sqrt(dSq)) * 255);
        if (value > cov[i]) cov[i] = value;
      }
    }
    return { minX, minY, maxX, maxY };
  }

  /** mask = committed strokes with the live coverage applied, over `rect`. */
  private composite(rect: PixelRect, erase: boolean): void {
    const { width, mask, base, cov } = this;
    for (let y = rect.minY; y <= rect.maxY; y++) {
      const row = y * width;
      for (let i = row + rect.minX; i <= row + rect.maxX; i++) {
        const c = cov[i];
        const b = base[i];
        mask[i] = erase
          ? Math.round((b * (255 - c)) / 255)
          : c > b
            ? c
            : b;
      }
    }
  }

  private copyRect(from: Uint8Array, to: Uint8Array, rect: PixelRect): void {
    const { width } = this;
    for (let y = rect.minY; y <= rect.maxY; y++) {
      const start = y * width + rect.minX;
      to.set(from.subarray(start, start + rect.maxX - rect.minX + 1), start);
    }
  }

  private clearRect(buffer: Uint8Array, rect: PixelRect): void {
    const { width } = this;
    for (let y = rect.minY; y <= rect.maxY; y++) {
      const start = y * width + rect.minX;
      buffer.fill(0, start, start + rect.maxX - rect.minX + 1);
    }
  }
}

function unionRect(a: PixelRect, b: PixelRect): PixelRect {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * Renders the strokes into a `width × height` coverage buffer
 * (0 = untouched, 255 = fully masked). Strokes are applied in order, so a
 * later erase cuts into everything painted before it.
 */
export function rasterizeMask(
  strokes: MaskStroke[],
  width: number,
  height: number,
  window = FULL_WINDOW,
): Uint8Array {
  const layer = new MaskLayer(width, height, window);
  layer.reset(strokes);
  return layer.mask;
}

/** Points stamped between two clock checks in `rasterizeMaskAsync`. */
const ASYNC_POINTS_PER_CHECK = 4;

/**
 * Same result as `rasterizeMask`, rendered in slices of about `sliceMs`
 * with the event loop free in between, so a full-size render never freezes
 * the UI. Resolves to null when `isCancelled` turns true midway.
 */
export async function rasterizeMaskAsync(
  strokes: MaskStroke[],
  width: number,
  height: number,
  options: { sliceMs?: number; isCancelled?: () => boolean } = {},
): Promise<Uint8Array | null> {
  const sliceMs = options.sliceMs ?? 12;
  const layer = new MaskLayer(width, height);
  let sliceStart = Date.now();
  for (const stroke of strokes) {
    layer.begin(stroke);
    while (layer.extend(ASYNC_POINTS_PER_CHECK, false)) {
      if (Date.now() - sliceStart < sliceMs) continue;
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (options.isCancelled?.()) return null;
      sliceStart = Date.now();
    }
    layer.commit();
  }
  return layer.mask;
}

/** true when no stroke left any coverage (nothing to inpaint). */
export function isMaskEmpty(mask: Uint8Array): boolean {
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 0) return false;
  }
  return true;
}

/**
 * Dimensions the mask is rasterized at: the source image's aspect ratio,
 * scaled so the long side is at most `maxSide`.
 *
 * The mask never needs the source's full resolution: ComfyUI interpolates
 * it down to the latent grid (an eighth of the image) before sampling, and
 * Impact Pack rescales SEGS to the image. What it does need is the *aspect
 * ratio*, or the bilinear resize would stretch the drawing off the area the
 * user painted.
 */
export function maskDimensions(
  imageWidth: number,
  imageHeight: number,
  maxSide: number,
): { width: number; height: number } {
  const longSide = Math.max(imageWidth, imageHeight);
  const scale = longSide > maxSide ? maxSide / longSide : 1;
  return {
    width: Math.max(1, Math.round(imageWidth * scale)),
    height: Math.max(1, Math.round(imageHeight * scale)),
  };
}

/** Grayscale PNG (base64) for upload, read back by LoadImageMask (`red`). */
export function maskToPngBase64(
  mask: Uint8Array,
  width: number,
  height: number,
): string {
  return encodePng(mask, width, height, 'gray');
}

/**
 * PNG (base64) for the on-screen overlay: the painted area in `color`
 * (`#rrggbb`), everything else fully transparent, so the source image shows
 * through unmasked. The colour is baked in rather than applied with a tint:
 * on iOS a tinted expo-image is downsampled to its unzoomed frame, which
 * would blur the zoomed-in close-up it exists to sharpen.
 */
export function maskToOverlayPngBase64(
  mask: Uint8Array,
  width: number,
  height: number,
  color: string,
): string {
  return encodePng(mask, width, height, 'alpha', hexToRgb(color));
}

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return [(v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}
