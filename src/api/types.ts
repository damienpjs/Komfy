/**
 * ComfyUI API response types, derived from the real responses recorded in
 * docs/api-notes.md (ComfyUI 0.27.0) — no guessing.
 */

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

/** Image reference returned by the output nodes (SaveImage…). */
export interface ImageRef {
  filename: string;
  subfolder: string;
  type: 'output' | 'input' | 'temp';
}

/**
 * Queue entry: tuple
 * [number, prompt_id, prompt_graph, extra_data, outputs_to_execute].
 */
export type QueueEntry = [
  number,
  string,
  Record<string, PromptNode>,
  Record<string, unknown>,
  string[],
];

export interface QueueResponse {
  queue_running: QueueEntry[];
  queue_pending: QueueEntry[];
}

/** Node of a graph in API format. */
export interface PromptNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

/** Full graph in API format (Save (API Format) in ComfyUI). */
export type PromptGraph = Record<string, PromptNode>;

/** Success response of POST /prompt. */
export interface PromptResponse {
  prompt_id: string;
  number: number;
  node_errors: Record<string, NodeErrors>;
}

export interface NodeErrorDetail {
  type: string;
  message: string;
  details: string;
  extra_info: Record<string, unknown>;
}

export interface NodeErrors {
  errors: NodeErrorDetail[];
  dependent_outputs: string[];
}

/** Error response (HTTP 400) of POST /prompt — graph validation. */
export interface PromptErrorResponse {
  error: {
    type: string; // 'prompt_outputs_failed_validation' | 'prompt_no_outputs' | …
    message: string;
    details: string;
    extra_info: Record<string, unknown>;
  };
  node_errors: Record<string, NodeErrors>;
}

export interface HistoryEntry {
  /** Same tuple as the queue entries — [2] is the job's API graph. */
  prompt?: QueueEntry;
  status: {
    status_str: 'success' | 'error';
    completed: boolean;
    messages: unknown[];
  };
  /** `text`: output of the text nodes (ShowText|pysssss, ui.text). */
  outputs: Record<string, { images?: ImageRef[]; text?: string[] }>;
}

/** GET /history → prompt_id → entry mapping. */
export type HistoryResponse = Record<string, HistoryEntry>;

export interface SystemStats {
  system: {
    os: string;
    ram_total: number;
    ram_free: number;
    comfyui_version: string;
    python_version: string;
    pytorch_version: string;
  };
  devices: {
    name: string;
    type: string;
    index: number | null;
    vram_total: number;
    vram_free: number;
  }[];
}

// ---------------------------------------------------------------------------
// WebSocket (/ws?clientId=…)
// ---------------------------------------------------------------------------

export interface StatusMessage {
  type: 'status';
  data: {
    status: { exec_info: { queue_remaining: number } };
    sid?: string;
  };
}

export interface ExecutionStartMessage {
  type: 'execution_start';
  data: { prompt_id: string; timestamp: number };
}

export interface ExecutionCachedMessage {
  type: 'execution_cached';
  data: { nodes: string[]; prompt_id: string; timestamp: number };
}

/** Running node; node: null = end of the prompt's execution. */
export interface ExecutingMessage {
  type: 'executing';
  data: { node: string | null; display_node?: string; prompt_id: string };
}

/** Sampler bar: value / max. */
export interface ProgressMessage {
  type: 'progress';
  data: { value: number; max: number; prompt_id: string; node: string };
}

export interface ProgressStateMessage {
  type: 'progress_state';
  data: {
    prompt_id: string;
    nodes: Record<
      string,
      { value: number; max: number; state: string; node_id: string }
    >;
  };
}

/** Output node result — contains the generated files. */
export interface ExecutedMessage {
  type: 'executed';
  data: {
    node: string;
    display_node?: string;
    output: { images?: ImageRef[] } & Record<string, unknown>;
    prompt_id: string;
  };
}

export interface ExecutionSuccessMessage {
  type: 'execution_success';
  data: { prompt_id: string; timestamp: number };
}

export interface ExecutionErrorMessage {
  type: 'execution_error';
  data: {
    prompt_id: string;
    node_id: string;
    node_type: string;
    executed: string[];
    exception_message: string;
    exception_type: string;
    traceback: string[];
  };
}

export type ComfyWsMessage =
  | StatusMessage
  | ExecutionStartMessage
  | ExecutionCachedMessage
  | ExecutingMessage
  | ProgressMessage
  | ProgressStateMessage
  | ExecutedMessage
  | ExecutionSuccessMessage
  | ExecutionErrorMessage;

/** WS types the client can parse (others — e.g. crystools.monitor — are ignored). */
export const KNOWN_WS_TYPES: ReadonlySet<string> = new Set([
  'status',
  'execution_start',
  'execution_cached',
  'executing',
  'progress',
  'progress_state',
  'executed',
  'execution_success',
  'execution_error',
]);
