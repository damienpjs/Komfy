/** Small display formatters (no RN dependency). */

/**
 * Coarse "time since" label — just now, 5 min ago, 3 h ago, 2 d ago.
 * Takes `t` rather than importing i18next: keeps this module RN- and
 * side-effect-free, and lets callers pass their own scoped translator.
 */
export function formatAgo(
  at: number,
  t: (key: string, opts?: { count: number }) => string,
): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return t('common.justNow');
  const m = Math.round(s / 60);
  if (m < 60) return t('common.minutesAgo', { count: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('common.hoursAgo', { count: h });
  const d = Math.round(h / 24);
  return t('common.daysAgo', { count: d });
}

/**
 * Human-readable byte size, e.g. 0 B, 512 B, 3.4 MB, 12 GB. Decimals only
 * below 10 units and above the byte scale (keeps the value compact).
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}
