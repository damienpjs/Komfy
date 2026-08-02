/**
 * Opens the supervisor's /ws while the console screen is mounted: replays the
 * recent log lines then tails live, feeding store/supervisor. Auto-reconnects
 * with exponential backoff (same shape as api/ws.ts). A `state` frame refreshes
 * the power card's health query so the card reacts without waiting for its poll.
 */

import { useEffect } from 'react';
import { queryClient } from '../api/queryClient';
import {
  createSupervisor,
  deriveSupervisorUrl,
  type SupervisorWsMessage,
} from '../api/supervisor';
import { useSettings } from '../store/settings';
import { useSupervisorStore } from '../store/supervisor';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export function useSupervisorLogs() {
  const serverUrl = useSettings((s) => s.serverUrl);
  const supervisorUrl = useSettings((s) => s.supervisorUrl);
  const token = useSettings((s) => s.supervisorToken);
  const hydrated = useSettings((s) => s.hydrated);
  const effectiveUrl = supervisorUrl || deriveSupervisorUrl(serverUrl);

  useEffect(() => {
    if (!hydrated || !effectiveUrl || !token) return;

    let ws: WebSocket | null = null;
    let disposed = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const { pushLog, setLogsConnected, setComfyState } =
      useSupervisorStore.getState();

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(createSupervisor(effectiveUrl, token).wsUrl());

      ws.onopen = () => {
        attempt = 0;
        setLogsConnected(true);
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        let msg: SupervisorWsMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type === 'log') {
          pushLog(msg.line, msg.at);
        } else if (msg.type === 'state') {
          setComfyState(msg.comfy);
          // Reflect the transition in the power card without waiting for its poll.
          queryClient.invalidateQueries({ queryKey: ['supervisorHealth'] });
        }
      };

      ws.onerror = () => {
        // onclose follows and handles reconnection.
      };

      ws.onclose = () => {
        setLogsConnected(false);
        if (disposed) return;
        const delay = Math.min(
          RECONNECT_BASE_MS * 2 ** attempt,
          RECONNECT_MAX_MS,
        );
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      setLogsConnected(false);
      ws?.close();
    };
  }, [hydrated, effectiveUrl, token]);
}
