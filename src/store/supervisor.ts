/**
 * Live console state for the supervisor's log stream (not persisted). Mirrors
 * the ring-buffer approach of store/connection.ts (wsLog): fed by
 * hooks/useSupervisorLogs, rendered by app/comfy-console.tsx.
 */

import { create } from 'zustand';
import type { ComfyState } from '../api/supervisor';

export interface SupervisorLogLine {
  id: number;
  at: number; // epoch ms
  line: string;
}

const MAX_LINES = 1000;
let nextId = 1;

interface SupervisorStoreState {
  logs: SupervisorLogLine[];
  /** WebSocket to the supervisor's /ws is open. */
  logsConnected: boolean;
  /** Last comfy state announced over the WS (supplements the health poll). */
  comfyState: ComfyState | null;

  pushLog: (line: string, at: number) => void;
  setLogsConnected: (connected: boolean) => void;
  setComfyState: (state: ComfyState) => void;
  clearLogs: () => void;
}

export const useSupervisorStore = create<SupervisorStoreState>((set) => ({
  logs: [],
  logsConnected: false,
  comfyState: null,

  pushLog: (line, at) =>
    set((s) => {
      const next = [...s.logs, { id: nextId++, at, line }];
      if (next.length > MAX_LINES) next.splice(0, next.length - MAX_LINES);
      return { logs: next };
    }),
  setLogsConnected: (logsConnected) => set({ logsConnected }),
  setComfyState: (comfyState) => set({ comfyState }),
  clearLogs: () => set({ logs: [] }),
}));
