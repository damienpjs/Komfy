/**
 * Typed HTTP client for the ComfyUI API.
 * Endpoints and formats validated against the real server — see
 * docs/api-notes.md.
 */

import type {
  HistoryResponse,
  PromptErrorResponse,
  PromptGraph,
  PromptResponse,
  QueueResponse,
  SystemStats,
} from './types';

const DEFAULT_TIMEOUT_MS = 8000;

/** Network/HTTP error enriched with the ComfyUI error body when present. */
export class ComfyApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: PromptErrorResponse | unknown,
  ) {
    super(message);
    this.name = 'ComfyApiError';
  }
}

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
    });
    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      throw new ComfyApiError(`HTTP ${res.status} on ${path}`, res.status, body);
    }
    // /interrupt and POST /queue answer 200 with an empty body.
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface ComfyClient {
  baseUrl: string;
  getQueue(): Promise<QueueResponse>;
  getSystemStats(): Promise<SystemStats>;
  getHistory(maxItems?: number): Promise<HistoryResponse>;
  /** History entry of a specific job ({} until it is finished). */
  getHistoryItem(promptId: string): Promise<HistoryResponse>;
  /** Flat listing of the output folder: ["<name> [<type>]", …]. Also used as the "volume mounted" probe. */
  listOutputFiles(): Promise<string[]>;
  /** Installed LoRAs, paths relative to the loras folder (with subfolders). */
  listLoras(): Promise<string[]>;
  /**
   * Recursive listing of the image roots (output + input) via the
   * komfy-listing extension (404 if absent). Every `path` is prefixed by
   * its root: `output/…` or `input/…`. `dir: true` marks an empty folder
   * (shown despite having no files); the bare root names are always emitted.
   */
  listFiles(): Promise<{ path: string; mtime: number; dir?: boolean }[]>;
  /**
   * "Deletes" files/folders (moved to <root>/.komfy-trash by the
   * komfy-listing extension — recoverable from the Mac). Paths are prefixed
   * by their root (`output/…`, `input/…`).
   */
  deletePaths(
    paths: string[],
  ): Promise<{ moved: string[]; errors: Record<string, string> }>;
  /**
   * Moves prefixed files/folders into `dest` (a prefixed folder, e.g.
   * `output/sub` or just `input`). Source and destination roots may differ
   * (input ↔ output). komfy-listing extension (404/405 if absent).
   */
  movePaths(
    paths: string[],
    dest: string,
  ): Promise<{ moved: string[]; errors: Record<string, string> }>;
  /** Creates a folder from a prefixed path (`output/sub`, `input/sub`). */
  createDir(path: string): Promise<{ created: string }>;
  /** Per-root trash contents ({count, bytes}) for the "empty trash" screen. */
  trashInfo(): Promise<Record<string, { count: number; bytes: number }>>;
  /**
   * Permanently empties the trash (all roots, or a single `root`). Returns
   * the freed {count, bytes} per root. Irreversible.
   */
  emptyTrash(
    root?: string,
  ): Promise<{ freed: Record<string, { count: number; bytes: number }> }>;
  postPrompt(prompt: PromptGraph, clientId: string): Promise<PromptResponse>;
  interrupt(): Promise<void>;
  deleteQueueItems(promptIds: string[]): Promise<void>;
  clearQueue(): Promise<void>;
  /**
   * Uploads a local image (phone URI) to ComfyUI's input folder, optionally
   * into `subfolder` (relative to input/, '' = root). Returns the
   * server-side filename (for LoadImage / the gallery's input root).
   */
  uploadImage(
    uri: string,
    name: string,
    subfolder?: string,
  ): Promise<{ name: string }>;
  /**
   * Display URL of an image (GET /view). `version` (usually the mtime) is
   * appended as a query param to bust expo-image's disk cache when a file
   * with the same name is regenerated (cf. SaveImage counter reuse after a
   * deletion → the unversioned URL would serve stale bytes).
   */
  viewUrl(
    filename: string,
    subfolder?: string,
    type?: string,
    version?: number | string,
  ): string;
  /** Real-time WebSocket URL. */
  wsUrl(clientId: string): string;
}

export function createClient(baseUrl: string): ComfyClient {
  // Normalize: no trailing slash.
  const base = baseUrl.replace(/\/+$/, '');
  return {
    baseUrl: base,

    getQueue: () => request<QueueResponse>(base, '/queue'),

    getSystemStats: () => request<SystemStats>(base, '/system_stats'),

    getHistory: (maxItems) =>
      request<HistoryResponse>(
        base,
        maxItems != null ? `/history?max_items=${maxItems}` : '/history',
      ),

    getHistoryItem: (promptId) =>
      request<HistoryResponse>(
        base,
        `/history/${encodeURIComponent(promptId)}`,
      ),

    // ⚠️ The path is /internal/files/output, NOT /internal/files?directory=output.
    listOutputFiles: () => request<string[]>(base, '/internal/files/output'),

    listLoras: () => request<string[]>(base, '/models/loras'),

    // Routes of the komfy-listing server extension (server/komfy-listing).
    // 404 = extension not installed / too old (history fallback on the
    // gallery side), 503 = output volume not mounted.
    listFiles: () =>
      request<{ path: string; mtime: number; dir?: boolean }[]>(
        base,
        '/komfy/files',
      ),

    deletePaths: (paths) =>
      request<{ moved: string[]; errors: Record<string, string> }>(
        base,
        '/komfy/delete',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths }),
        },
      ),

    movePaths: (paths, dest) =>
      request<{ moved: string[]; errors: Record<string, string> }>(
        base,
        '/komfy/move',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths, dest }),
        },
      ),

    createDir: (path) =>
      request<{ created: string }>(base, '/komfy/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      }),

    trashInfo: () =>
      request<Record<string, { count: number; bytes: number }>>(
        base,
        '/komfy/trash',
      ),

    emptyTrash: (root) =>
      request<{ freed: Record<string, { count: number; bytes: number }> }>(
        base,
        '/komfy/trash/empty',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(root ? { root } : {}),
        },
      ),

    postPrompt: (prompt, clientId) =>
      request<PromptResponse>(base, '/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, client_id: clientId }),
      }),

    interrupt: () => request<void>(base, '/interrupt', { method: 'POST' }),

    deleteQueueItems: (promptIds) =>
      request<void>(base, '/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delete: promptIds }),
      }),

    clearQueue: () =>
      request<void>(base, '/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true }),
      }),

    uploadImage: async (uri, name, subfolder = '') => {
      const form = new FormData();
      // React Native file object (local phone uri).
      form.append('image', {
        uri,
        name,
        type: name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
      } as unknown as Blob);
      form.append('type', 'input');
      if (subfolder !== '') form.append('subfolder', subfolder);
      const res = await fetch(`${base}/upload/image`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        throw new ComfyApiError(`HTTP ${res.status} on /upload/image`, res.status);
      }
      return (await res.json()) as { name: string };
    },

    viewUrl: (filename, subfolder = '', type = 'output', version) =>
      `${base}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}` +
      (version != null ? `&v=${encodeURIComponent(String(version))}` : ''),

    wsUrl: (clientId) =>
      `${base.replace(/^http/, 'ws')}/ws?clientId=${encodeURIComponent(clientId)}`,
  };
}

/**
 * Connection test for the Settings screen: /system_stats also provides the
 * ComfyUI version to display.
 */
export async function testConnection(
  baseUrl: string,
): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  try {
    const stats = await createClient(baseUrl).getSystemStats();
    return { ok: true, version: stats.system.comfyui_version };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
