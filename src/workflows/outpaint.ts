/**
 * Outpainting geometry (Krea 2 AnyPaint): pure functions shared by the form
 * (live preview, templates) and the patcher (graph values).
 *
 * The user works in SOURCE pixels: "+672 px on the right of a 4032 px photo".
 * The model works at a pixel budget (≈1 MP): Krea 2 is trained up to about
 * 2 MP and AnyPaint's own examples sit at 1536×1024, so a 12 MP photo plus
 * its expansion is scaled down before sampling, then the generated canvas is
 * scaled back up and the original pixels are pasted over it (cf. the restore
 * branch in krea2-outpaint.ts).
 *
 * That round trip only lines up if the working geometry is a uniform
 * per-axis scale of the final one. So the generated canvas is sized first
 * (multiple of 16, AnyPaint's token grid: VAE /8 × patch 2) and the source
 * and paddings are derived from it with the SAME factor. The canvas aspect
 * may differ from the final one by a few pixels; the source is stretched by
 * that amount on the way down and un-stretched on the way back, so the two
 * cancel out and the original lands on its own generated copy.
 */

import type { OutpaintAnchor, OutpaintValue } from './types';

/** AnyPaint canvas alignment (Krea2AnyPaintPrepare pads to it otherwise). */
export const OUTPAINT_ALIGN = 16;

/** One "MP" of budget, the convention of the edit workflow (1024² = 1 MP). */
const MEGAPIXEL = 1024 * 1024;

/** Each side may grow up to this many times the source on its axis. */
export const OUTPAINT_MAX_SIDE_FACTOR = 4;

/**
 * Smallest expansion worth generating on a side, in source pixels: below it
 * the strip is a sub-token sliver at working resolution.
 */
export const OUTPAINT_MIN_SIDE = 16;

/** Drag granularity in the editor, in source pixels. */
export const OUTPAINT_DRAG_STEP = 8;

/**
 * Share of the canvas to generate above which the form warns. Both community
 * adapters note that very large missing regions may bring in a second subject
 * or an unrelated scene; 60 % is a heuristic threshold, not a measured one.
 */
export const OUTPAINT_RISKY_FRACTION = 0.6;

export type OutpaintSide = 'left' | 'top' | 'right' | 'bottom';
export const OUTPAINT_SIDES: OutpaintSide[] = ['left', 'top', 'right', 'bottom'];

export interface Sides {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Aspect-ratio templates: the canvas grows on one axis to reach the ratio. */
export const RATIO_TEMPLATES: { id: string; w: number; h: number }[] = [
  { id: '1:1', w: 1, h: 1 },
  { id: '4:5', w: 4, h: 5 },
  { id: '3:4', w: 3, h: 4 },
  { id: '2:3', w: 2, h: 3 },
  { id: '9:16', w: 9, h: 16 },
  { id: '16:9', w: 16, h: 9 },
  { id: '3:2', w: 3, h: 2 },
  { id: '4:3', w: 4, h: 3 },
  { id: '21:9', w: 21, h: 9 },
];

/** Zoom-out templates: both axes grow by this factor. */
export const ZOOM_TEMPLATES = [1.25, 1.5, 2];

export const ratioTemplateId = (id: string) => `ratio:${id}`;
export const zoomTemplateId = (k: number) => `zoom:${k}`;

const ZERO: Sides = { left: 0, top: 0, right: 0, bottom: 0 };

/**
 * Share of a horizontal (or vertical) expansion that goes to the left (or
 * top), given where the source is anchored: anchored left = everything on the
 * right.
 */
function anchorShares(anchor: OutpaintAnchor): { x: number; y: number } {
  const col = anchor.endsWith('l') ? 0 : anchor.endsWith('r') ? 1 : 0.5;
  const row = anchor.startsWith('t') ? 0 : anchor.startsWith('b') ? 1 : 0.5;
  // 'l' and 'r' alone are the middle row; 't' and 'b' alone the middle column.
  return {
    x: anchor === 't' || anchor === 'b' || anchor === 'c' ? 0.5 : col,
    y: anchor === 'l' || anchor === 'r' || anchor === 'c' ? 0.5 : row,
  };
}

function split(extra: number, share: number): [number, number] {
  const first = Math.round(extra * share);
  return [first, extra - first];
}

/** Paddings a template gives for a source size, or null when unknown. */
export function templateSides(
  width: number,
  height: number,
  template: string,
  anchor: OutpaintAnchor,
): Sides | null {
  if (!width || !height) return null;
  const share = anchorShares(anchor);
  if (template.startsWith('ratio:')) {
    const def = RATIO_TEMPLATES.find((r) => ratioTemplateId(r.id) === template);
    if (!def) return null;
    const target = def.w / def.h;
    const current = width / height;
    // Within a pixel of the ratio already: nothing to add.
    if (Math.abs(current - target) * height < 1) return { ...ZERO };
    if (current < target) {
      const [left, right] = split(Math.round(height * target) - width, share.x);
      return { left, top: 0, right, bottom: 0 };
    }
    const [top, bottom] = split(Math.round(width / target) - height, share.y);
    return { left: 0, top, right: 0, bottom };
  }
  if (template.startsWith('zoom:')) {
    const k = Number(template.slice('zoom:'.length));
    if (!Number.isFinite(k) || k <= 1) return null;
    const [left, right] = split(Math.round(width * (k - 1)), share.x);
    const [top, bottom] = split(Math.round(height * (k - 1)), share.y);
    return { left, top, right, bottom };
  }
  return null;
}

/** Upper bound of one side, in source pixels. */
export function maxSide(value: OutpaintValue, side: OutpaintSide): number {
  const dim =
    side === 'left' || side === 'right' ? value.sourceWidth : value.sourceHeight;
  return Math.max(0, Math.round(dim * OUTPAINT_MAX_SIDE_FACTOR));
}

/** Integer paddings within [0, maxSide]. */
export function clampSides(value: OutpaintValue): OutpaintValue {
  const next = { ...value };
  for (const side of OUTPAINT_SIDES) {
    const n = Math.round(Number(value[side]));
    next[side] = Number.isFinite(n)
      ? Math.max(0, Math.min(maxSide(value, side), n))
      : 0;
  }
  return next;
}

export function initialOutpaintValue(budget: number): OutpaintValue {
  return {
    ...ZERO,
    budget,
    anchor: 'c',
    template: null,
    sourceWidth: 0,
    sourceHeight: 0,
    pendingScale: null,
  };
}

/** Applies a template on the current source (no-op until it is measured). */
export function applyTemplate(
  value: OutpaintValue,
  template: string,
): OutpaintValue {
  const sides = templateSides(
    value.sourceWidth,
    value.sourceHeight,
    template,
    value.anchor,
  );
  if (!sides) return value;
  return clampSides({ ...value, ...sides, template });
}

/**
 * Brings a value in line with the source actually loaded in the form:
 *  - a remix read in working pixels is rescaled to source pixels;
 *  - a template is re-applied (a saved preset "16:9, anchored left" stays
 *    exactly that on the next photo);
 *  - manual paddings follow the new size proportionally.
 * Returns the same object when nothing changes, so the caller can skip the
 * state update.
 */
export function reconcileSource(
  value: OutpaintValue,
  width: number,
  height: number,
): OutpaintValue {
  if (
    value.sourceWidth === width &&
    value.sourceHeight === height &&
    !value.pendingScale
  ) {
    return value;
  }
  const measured = { ...value, sourceWidth: width, sourceHeight: height };
  let sides: Sides = {
    left: value.left,
    top: value.top,
    right: value.right,
    bottom: value.bottom,
  };
  const scaleFrom = value.pendingScale
    ? value.pendingScale
    : value.sourceWidth && value.sourceHeight
      ? { width: value.sourceWidth, height: value.sourceHeight }
      : null;
  if (value.template && !value.pendingScale) {
    sides = templateSides(width, height, value.template, value.anchor) ?? sides;
  } else if (scaleFrom) {
    const kx = width / scaleFrom.width;
    const ky = height / scaleFrom.height;
    sides = {
      left: Math.round(sides.left * kx),
      right: Math.round(sides.right * kx),
      top: Math.round(sides.top * ky),
      bottom: Math.round(sides.bottom * ky),
    };
  }
  return clampSides({ ...measured, ...sides, pendingScale: null });
}

export function finalSize(value: OutpaintValue): Size {
  return {
    width: value.sourceWidth + value.left + value.right,
    height: value.sourceHeight + value.top + value.bottom,
  };
}

/** Share of the final canvas that is generated (0 → 1). */
export function generatedFraction(value: OutpaintValue): number {
  const f = finalSize(value);
  if (!f.width || !f.height) return 0;
  return 1 - (value.sourceWidth * value.sourceHeight) / (f.width * f.height);
}

export function hasExpansion(value: OutpaintValue): boolean {
  return OUTPAINT_SIDES.some((s) => value[s] > 0);
}

export interface OutpaintPlan {
  /** Restored output, source pixels (= source + paddings). */
  final: Size;
  /** Generated canvas (multiples of 16). */
  canvas: Size;
  /** Source resized for sampling. */
  working: Size;
  /** Paddings at working resolution. */
  pad: Sides;
  /** canvas / final, per axis (the uniform scale of the round trip). */
  factor: { x: number; y: number };
}

function roundToAlign(n: number): number {
  return Math.max(OUTPAINT_ALIGN, Math.round(n / OUTPAINT_ALIGN) * OUTPAINT_ALIGN);
}

/**
 * One axis of the plan. The canvas is sized first, then the source and the
 * two paddings take the same factor; the rounding remainder lands on the
 * source (sub-pixel at working scale) when a side does not grow, so a side
 * left at 0 stays at 0 and is never generated.
 */
function planAxis(
  src: number,
  a: number,
  b: number,
  scale: number,
): { canvas: number; size: number; a: number; b: number } {
  const total = src + a + b;
  const canvas = roundToAlign(total * scale);
  const k = canvas / total;
  let pa = a > 0 ? Math.max(1, Math.round(a * k)) : 0;
  let pb = b > 0 ? Math.max(1, Math.round(b * k)) : 0;
  if (a > 0 && b > 0) {
    // Both grow: the source keeps its proportional size, the far side takes
    // the remainder (never below one pixel).
    const size = Math.max(1, Math.round(src * k));
    pb = Math.max(1, canvas - size - pa);
    pa = canvas - size - pb;
  }
  return { canvas, size: canvas - pa - pb, a: pa, b: pb };
}

/** The whole working geometry, or null until the source is measured. */
export function planOutpaint(value: OutpaintValue): OutpaintPlan | null {
  const { sourceWidth: w, sourceHeight: h } = value;
  if (!w || !h) return null;
  const final = finalSize(value);
  const budget = Math.max(0.1, value.budget) * MEGAPIXEL;
  // Never upscale: a small source is generated at its own size (AnyPaint
  // places the source without resizing it; upscaling would only soften it).
  const scale = Math.min(1, Math.sqrt(budget / (final.width * final.height)));
  const x = planAxis(w, value.left, value.right, scale);
  const y = planAxis(h, value.top, value.bottom, scale);
  return {
    final,
    canvas: { width: x.canvas, height: y.canvas },
    working: { width: x.size, height: y.size },
    pad: { left: x.a, right: x.b, top: y.a, bottom: y.b },
    factor: { x: x.canvas / final.width, y: y.canvas / final.height },
  };
}

/**
 * Working pixels between the seam and the first token AnyPaint is guaranteed
 * to have preserved: its keep mask is the source minus the redraw band, then
 * rounded to whole 16 px tokens (a token is kept only if all of it is).
 */
const TOKEN_SLOP = OUTPAINT_ALIGN;
/** Working pixels over which the pasted original fades in, inside that area. */
const RESTORE_RAMP = OUTPAINT_ALIGN;
/** The pasted original never covers less than this share of the source per axis. */
const MIN_PASTE_SHARE = 0.4;

export interface RestoreGeometry {
  /** Source pixels left to the render on each side (0 on a side that did not grow). */
  inset: Sides;
  /** Fade-in width of the paste on each grown side, source pixels. */
  ramp: Sides;
  /** Size of the pasted area (source minus the insets). */
  paste: Size;
}

/**
 * Where the original goes back over the upscaled render. Not up to the seam:
 * inside the redraw band the model is free to draw across the source edge (a
 * shed continuing into what was sky), and fading the original in over that
 * leaves a half-transparent ghost of it. So the band, plus the token slop, is
 * left to the render, which blends with the new area by construction, and the
 * original fades in just beyond, where the render already matches it (only
 * its resolution differs).
 */
export function restoreGeometry(
  value: OutpaintValue,
  plan: OutpaintPlan,
  bandWorking: number,
): RestoreGeometry {
  const band = Math.max(0, bandWorking) + TOKEN_SLOP;
  const capX = Math.floor((value.sourceWidth * (1 - MIN_PASTE_SHARE)) / 2);
  const capY = Math.floor((value.sourceHeight * (1 - MIN_PASTE_SHARE)) / 2);
  const inset = (grown: boolean, factor: number, cap: number) =>
    grown ? Math.min(cap, Math.round(band / factor)) : 0;
  const i: Sides = {
    left: inset(value.left > 0, plan.factor.x, capX),
    right: inset(value.right > 0, plan.factor.x, capX),
    top: inset(value.top > 0, plan.factor.y, capY),
    bottom: inset(value.bottom > 0, plan.factor.y, capY),
  };
  const rampX = Math.max(1, Math.round(RESTORE_RAMP / plan.factor.x));
  const rampY = Math.max(1, Math.round(RESTORE_RAMP / plan.factor.y));
  return {
    inset: i,
    ramp: {
      left: i.left > 0 ? rampX : 0,
      right: i.right > 0 ? rampX : 0,
      top: i.top > 0 ? rampY : 0,
      bottom: i.bottom > 0 ? rampY : 0,
    },
    paste: {
      width: value.sourceWidth - i.left - i.right,
      height: value.sourceHeight - i.top - i.bottom,
    },
  };
}

/**
 * Budget a remixed render was made with: the smallest offered budget that
 * holds its generated canvas (a canvas under budget was never scaled, so the
 * smallest that fits reproduces it; one at budget lands within rounding).
 */
export function budgetForCanvas(canvasPixels: number, budgets: number[]): number {
  const sorted = [...budgets].sort((p, q) => p - q);
  return (
    sorted.find((b) => b * MEGAPIXEL >= canvasPixels * 0.9) ??
    sorted[sorted.length - 1]
  );
}

const NAMED_RATIOS: [number, string][] = [
  [1, '1:1'],
  [5 / 4, '5:4'],
  [4 / 3, '4:3'],
  [3 / 2, '3:2'],
  [16 / 10, '16:10'],
  [16 / 9, '16:9'],
  [2, '2:1'],
  [21 / 9, '21:9'],
];

/** "16:9", "4:5", or "≈1.83" when no usual ratio is within 1 %. */
export function ratioLabel(width: number, height: number): string {
  if (!width || !height) return '';
  const r = Math.max(width, height) / Math.min(width, height);
  const named = NAMED_RATIOS.find(([v]) => Math.abs(r - v) / v < 0.01);
  if (!named) return `≈${(width / height).toFixed(2)}`;
  if (width >= height) return named[1];
  const [a, b] = named[1].split(':');
  return `${b}:${a}`;
}
