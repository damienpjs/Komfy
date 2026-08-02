/**
 * Pairing code helpers. The server prints a `komfy://setup?u=…&s=…&t=…` deep
 * link (scripts/pair.js) carrying the ComfyUI URL, the supervisor URL and the
 * supervisor token. Scanned in-app (PairingScanner), pasted, or opened via the
 * OS (deep link in app/_layout.tsx) — all funnel through parsePairingCode +
 * applyPairing.
 */

import { useSettings } from '../store/settings';

export interface PairingResult {
  serverUrl: string;
  supervisorUrl: string;
  token: string;
}

function param(input: string, key: string): string {
  const m = input.match(new RegExp(`[?&]${key}=([^&#\\s]+)`));
  if (!m) return '';
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * Parses a pasted/scanned pairing code. Tolerant: accepts the full
 * `komfy://setup?...` link, or a bare `u=…&s=…&t=…` query. Rejects a URL that
 * carries a *different* scheme (avoids grabbing junk). Returns null when it
 * carries none of the three fields.
 */
export function parsePairingCode(input: string): PairingResult | null {
  if (!input) return null;
  const s = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^komfy:\/\//i.test(s)) return null;
  const result: PairingResult = {
    serverUrl: param(s, 'u'),
    supervisorUrl: param(s, 's'),
    token: param(s, 't'),
  };
  if (!result.serverUrl && !result.supervisorUrl && !result.token) return null;
  return result;
}

/** Applies a pairing result to the persisted settings (only the fields set). */
export function applyPairing(r: PairingResult): void {
  const s = useSettings.getState();
  if (r.serverUrl) s.setServerUrl(r.serverUrl);
  if (r.supervisorUrl) s.setSupervisorUrl(r.supervisorUrl);
  if (r.token) s.setSupervisorToken(r.token);
}

/**
 * Normalizes a hand-typed server address: adds the http:// scheme and the
 * default :8188 port when missing, so a bare Tailscale IP or a MagicDNS
 * hostname (e.g. `my-mac` or `100.85.227.29`) becomes a valid URL.
 */
export function normalizeServerUrl(input: string): string {
  let s = input.trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  const m = s.match(/^(https?:\/\/[^/:\s]+)(:\d+)?(\/.*)?$/i);
  if (m && !m[2]) s = `${m[1]}:8188${m[3] ?? ''}`;
  return s.replace(/\/+$/, '');
}
