/**
 * Readable label for a set of settings, for the prompt history.
 * Prefers the first non-empty text field (usually the positive prompt),
 * then the first zone prompt (Detect & Replace), then a generic label.
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

export function presetLabel(
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
