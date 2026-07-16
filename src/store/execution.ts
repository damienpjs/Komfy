/**
 * Execution state of the running job, fed by the WS messages.
 * ⚠️ ComfyUI routes `executing`/`progress`/`executed` to the sid that
 * submitted the job (cf. docs/api-notes.md): this store is only populated
 * for jobs queued by Komfy. For third-party jobs (desktop front-end), the
 * "running job" card relies on GET /queue polling, without a fine %.
 */

import { create } from 'zustand';
import type { ComfyWsMessage } from '../api/types';
import type { WsPreview } from '../utils/wsPreview';

export interface ExecutionError {
  promptId: string;
  nodeType: string;
  message: string;
  at: number;
}

interface ExecutionState {
  /** prompt_id of the job whose WS events we receive. */
  promptId: string | null;
  /** Currently executing node (id). */
  node: string | null;
  /** Progression du sampler (messages `progress`). */
  value: number;
  max: number;
  startedAt: number | null;
  lastError: ExecutionError | null;
  /** Preview of the running sampler (binary WS frames — Komfy jobs only). */
  preview: WsPreview | null;

  applyWsMessage: (msg: ComfyWsMessage) => void;
  setPreview: (preview: WsPreview) => void;
  clearError: () => void;
}

export const useExecution = create<ExecutionState>((set) => ({
  promptId: null,
  node: null,
  value: 0,
  max: 0,
  startedAt: null,
  lastError: null,
  preview: null,

  applyWsMessage: (msg) => {
    switch (msg.type) {
      case 'execution_start':
        set({
          promptId: msg.data.prompt_id,
          node: null,
          value: 0,
          max: 0,
          startedAt: Date.now(),
          preview: null,
        });
        break;
      case 'executing':
        if (msg.data.node == null) {
          set({ promptId: null, node: null, value: 0, max: 0, startedAt: null, preview: null });
        } else {
          set({ node: msg.data.node });
        }
        break;
      case 'progress':
        set({
          promptId: msg.data.prompt_id,
          node: msg.data.node,
          value: msg.data.value,
          max: msg.data.max,
        });
        break;
      case 'execution_success':
        set({ promptId: null, node: null, value: 0, max: 0, startedAt: null, preview: null });
        break;
      case 'execution_error':
        set({
          promptId: null,
          node: null,
          value: 0,
          max: 0,
          startedAt: null,
          preview: null,
          lastError: {
            promptId: msg.data.prompt_id,
            nodeType: msg.data.node_type,
            message: msg.data.exception_message,
            at: Date.now(),
          },
        });
        break;
    }
  },

  setPreview: (preview) => set({ preview }),

  clearError: () => set({ lastError: null }),
}));
