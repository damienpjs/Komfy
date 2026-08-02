/**
 * Client for the Komfy supervisor (server/supervisor) — the standalone service
 * that turns ComfyUI on/off and streams its console. Separate from the ComfyUI
 * client (api/client.ts) because it answers on its own port even when ComfyUI
 * is down. See server/supervisor/README.md for the endpoints.
 */

const DEFAULT_TIMEOUT_MS = 6000;

export type ComfyState = 'up' | 'down' | 'starting';

export interface SupervisorHealth {
  supervisor: string;
  comfy: ComfyState;
  pid: number | null;
  since: number | null;
}

/** WS frames pushed by the supervisor (see index.js). */
export type SupervisorWsMessage =
  | { type: 'log'; line: string; at: number }
  | { type: 'state'; comfy: ComfyState; code?: number; at?: number };

export class SupervisorError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'SupervisorError';
  }
}

/**
 * Default supervisor URL derived from the ComfyUI server URL: same host, port
 * + 1 (8188 → 8189, the supervisor's default). Used when the user leaves the
 * supervisor URL blank. Regex-based (RN's URL API is incomplete).
 */
export function deriveSupervisorUrl(serverUrl: string): string {
  const m = serverUrl.trim().match(/^(https?:\/\/[^/:\s]+)(?::(\d+))?/i);
  if (!m) return '';
  const host = m[1];
  const port = m[2] ? Number(m[2]) : 8188;
  return `${host}:${port + 1}`;
}

async function request<T>(
  baseUrl: string,
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        /* empty body */
      }
      throw new SupervisorError(message, res.status);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  } catch (e) {
    if (e instanceof SupervisorError) throw e;
    // Network failure / timeout → the supervisor is unreachable.
    throw new SupervisorError(
      e instanceof Error ? e.message : String(e),
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface SupervisorClient {
  baseUrl: string;
  /** GET /health — no token required (up/down is harmless). */
  health(): Promise<SupervisorHealth>;
  /** POST /start — 409 (SupervisorError.status) when ComfyUI already runs. */
  start(): Promise<{ starting: boolean }>;
  /** POST /stop. */
  stop(): Promise<{ stopped: boolean }>;
  /** WebSocket URL for the live console (token in the query string). */
  wsUrl(): string;
}

export function createSupervisor(baseUrl: string, token: string): SupervisorClient {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    baseUrl: base,
    health: () => request<SupervisorHealth>(base, '/health', token),
    start: () =>
      request<{ starting: boolean }>(base, '/start', token, { method: 'POST' }),
    stop: () =>
      request<{ stopped: boolean }>(base, '/stop', token, { method: 'POST' }),
    wsUrl: () =>
      `${base.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`,
  };
}
