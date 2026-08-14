/**
 * Rasterizes the finger-drawn inpaint strokes into an 8-bit mask.
 *
 * Strokes are stored resolution-independently — points in normalized image
 * space (0..1), radius as a fraction of the image's long side — so the same
 * stroke list renders both the small on-screen preview and the full-size
 * mask uploaded to ComfyUI, with no drift between what the user sees and
 * what the sampler gets.
 *
 * Each segment is stamped as a capsule (the set of pixels within `radius`
 * of the segment) rather than a run of discs: no overdraw seams, and the
 * 1-pixel soft edge falls out of the distance test for free — which matters,
 * because a hard-edged mask is exactly what makes an inpaint seam visible.
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

/** Squared distance from a point to a segment. */
function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  // Degenerate segment (a tap, or two identical samples) → plain disc.
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return Math.sqrt(cx * cx + cy * cy);
}

/**
 * Paints one capsule into `mask`. `erase` multiplies the existing coverage
 * down instead of raising it, so erasing a feathered edge stays feathered.
 */
function stampCapsule(
  mask: Uint8Array,
  width: number,
  height: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
  erase: boolean,
): void {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx) - radius - 1));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + radius + 1));
  const minY = Math.max(0, Math.floor(Math.min(ay, by) - radius - 1));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by) + radius + 1));

  for (let y = minY; y <= maxY; y++) {
    const row = y * width;
    for (let x = minX; x <= maxX; x++) {
      const d = distanceToSegment(x + 0.5, y + 0.5, ax, ay, bx, by);
      // Coverage ramps over the last pixel of the radius — the soft edge.
      const coverage = Math.max(0, Math.min(1, radius + 0.5 - d));
      if (coverage === 0) continue;
      const i = row + x;
      const value = coverage * 255;
      mask[i] = erase
        ? Math.round((mask[i] * (255 - value)) / 255)
        : Math.max(mask[i], Math.round(value));
    }
  }
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
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const longSide = Math.max(width, height);
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    // Sub-pixel radii would vanish on the small preview raster; keep the
    // brush visible at every resolution.
    const radius = Math.max(0.5, stroke.radius * longSide);
    const [first] = stroke.points;
    if (stroke.points.length === 1) {
      stampCapsule(
        mask,
        width,
        height,
        first.x * width,
        first.y * height,
        first.x * width,
        first.y * height,
        radius,
        stroke.erase,
      );
      continue;
    }
    for (let i = 1; i < stroke.points.length; i++) {
      const a = stroke.points[i - 1];
      const b = stroke.points[i];
      stampCapsule(
        mask,
        width,
        height,
        a.x * width,
        a.y * height,
        b.x * width,
        b.y * height,
        radius,
        stroke.erase,
      );
    }
  }
  return mask;
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
 * The mask never needs the source's full resolution — ComfyUI interpolates
 * it down to the latent grid (an eighth of the image) before sampling. What
 * it does need is the *aspect ratio*, or the bilinear resize would stretch
 * the drawing off the area the user painted.
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

/** Grayscale PNG (base64) for upload — read back by LoadImageMask (`red`). */
export function maskToPngBase64(
  mask: Uint8Array,
  width: number,
  height: number,
): string {
  return encodePng(mask, width, height, 1);
}

/**
 * Gray+alpha PNG (base64) for the on-screen overlay: the painted area is
 * opaque white (tinted by the caller), everything else fully transparent,
 * so the source image shows through unmasked.
 */
export function maskToOverlayPngBase64(
  mask: Uint8Array,
  width: number,
  height: number,
): string {
  const samples = new Uint8Array(width * height * 2);
  for (let i = 0; i < mask.length; i++) {
    samples[i * 2] = 255;
    samples[i * 2 + 1] = mask[i];
  }
  return encodePng(samples, width, height, 2);
}
