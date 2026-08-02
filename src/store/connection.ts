/**
 * Global connection state (not persisted): server reachable, WS open,
 * output folder available, and WS event log for debugging.
 */

import { create } from 'zustand';
import type { ComfyWsMessage } from '../api/types';

export interface WsLogEntry {
  id: number;
  at: number; // Date.now()
  type: ComfyWsMessage['type'];
  summary: string;
}

const MAX_LOG_ENTRIES = 100;
let nextLogId = 1;

interface ConnectionState {
  /** GET /queue answers → server reachable. null = not probed yet. */
  online: boolean | null;
  /** WebSocket /ws open. */
  wsConnected: boolean;
  /**
   * /internal/files/output probe OK. false while online=true
   * → the output folder is unavailable on the server (error banner).
   * null = not probed yet.
   */
  outputAvailable: boolean | null;
  /** Remaining jobs according to the WS `status` messages. */
  queueRemaining: number | null;
  wsLog: WsLogEntry[];

  setOnline: (online: boolean) => void;
  setWsConnected: (connected: boolean) => void;
  setOutputAvailable: (available: boolean) => void;
  setQueueRemaining: (n: number) => void;
  pushWsLog: (type: ComfyWsMessage['type'], summary: string) => void;
  clearWsLog: () => void;
}

export const useConnection = create<ConnectionState>((set) => ({
  online: null,
  wsConnected: false,
  outputAvailable: null,
  queueRemaining: null,
  wsLog: [],

  setOnline: (online) => set({ online }),
  setWsConnected: (wsConnected) => set({ wsConnected }),
  setOutputAvailable: (outputAvailable) => set({ outputAvailable }),
  setQueueRemaining: (queueRemaining) => set({ queueRemaining }),
  pushWsLog: (type, summary) =>
    set((s) => ({
      wsLog: [
        { id: nextLogId++, at: Date.now(), type, summary },
        ...s.wsLog,
      ].slice(0, MAX_LOG_ENTRIES),
    })),
  clearWsLog: () => set({ wsLog: [] }),
}));
