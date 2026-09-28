/**
 * Preset helpers for the launch form: what a preset keeps, how it is put
 * back, and the name suggested when saving one.
 */

import i18n from '../i18n';
import type {
  FieldValues,
  WorkflowField,
  ZonesValue,
} from '../workflows/types';

const MAX_LEN = 48;

function truncate(v: string): string {
  const t = v.trim().replace(/\s+/g, ' ');
  return t.length > MAX_LEN ? `${t.slice(0, MAX_LEN)}…` : t;
}

/**
 * Source pictures and masks belong to one photo, not to a way of working:
 * a preset leaves them out, and applying one never clears them.
 */
function isPerPhoto(field: WorkflowField): boolean {
  return field.kind === 'image' || field.kind === 'mask';
}

/** The form values a preset keeps: every field of the manifest but the per-photo ones. */
export function presetValues(
  fields: WorkflowField[],
  values: FieldValues,
): FieldValues {
  const kept: FieldValues = {};
  for (const f of fields) {
    if (isPerPhoto(f) || values[f.key] == null) continue;
    kept[f.key] = values[f.key];
  }
  return kept;
}

/**
 * The form once a preset is applied on top of it. Only fields the manifest
 * still knows are touched (a field removed since the save stays inert), and a
 * select index the options no longer reach keeps the current choice.
 */
export function applyPresetValues(
  fields: WorkflowField[],
  current: FieldValues,
  preset: FieldValues,
): FieldValues {
  const next = { ...current };
  for (const f of fields) {
    const v = preset[f.key];
    if (isPerPhoto(f) || v == null) continue;
    if (
      f.kind === 'select' &&
      (typeof v !== 'number' || v < 0 || v >= f.options.length)
    ) {
      continue;
    }
    next[f.key] = v;
  }
  return next;
}

/**
 * Name suggested in the save dialog. Prefers the first non-empty text field
 * (usually the positive prompt), then the first zone prompt (Detect &
 * Replace), then a generic label.
 */
export function suggestPresetName(
  fields: WorkflowField[],
  values: FieldValues,
): string {
  for (const f of fields) {
    if (f.kind === 'text') {
      const v = String(values[f.key] ?? '').trim();
      if (v) return truncate(v);
    }
  }
  for (const f of fields) {
    if (f.kind === 'zones') {
      const zv = values[f.key] as ZonesValue | undefined;
      const withPrompt = zv?.zones.find((z) => z.prompt.trim());
      if (withPrompt) return truncate(withPrompt.prompt);
    }
  }
  return i18n.t('presets.fallback');
}
