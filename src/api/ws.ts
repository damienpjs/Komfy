/**
 * WebSocket hook /ws?clientId=…: auto reconnection (exponential backoff),
 * parsing of the known messages, feeding of the connection store.
 * Binary frames (previews) and unknown types (e.g. crystools.monitor from
 * the Crystools custom node) are ignored — see docs/api-notes.md.
 */

import { useEffect, useRef } from 'react';
import { notifyJobDone, notifyJobFailed } from '../notifications';
import { useConnection } from '../store/connection';
import { useExecution } from '../store/execution';
import { useGeneratedPrompts } from '../store/generatedPrompts';
import { useSettings } from '../store/settings';
import { parsePreviewFrame } from '../utils/wsPreview';
import { createClient } from './client';
import { queryClient } from './queryClient';
import { KNOWN_WS_TYPES, type ComfyWsMessage } from './types';

/** Event types that change the queue content → refetch. */
const QUEUE_INVALIDATING_TYPES: ReadonlySet<string> = new Set([
  'status',
  'execution_start',
  'executed',
  'execution_success',
  'execution_error',
]);

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

/** Files produced per prompt (`executed` messages), for the notification. */
const outputsByPrompt = new Map<string, string[]>();

/**
 * Text surfaced by an output node (ShowText|pysssss → ui.text), joined the
 * same way the result screen joins /history's `outputs[node].text`.
 *
 * ⚠️ Unconfirmed shape: docs/api-notes.md records an `executed` message for
 * a SaveImage node only (`output.images`), never for a text node. ComfyUI
 * puts the node's `ui` dict in both `executed.output` and /history's
 * `outputs`, so `output.text` should hold — but it is a deduction, hence the
 * strict narrowing below. If it is wrong this returns null, the WS simply
 * resolves nothing, and the library's catch-up still fills the prompt in
 * from /history (verified — the result screen reads it that way): slower,
 * never wrong. Worth capturing a real message to settle it.
 */
function textOutput(output: Record<string, unknown> | null | undefined): string | null {
  // ComfyUI sends `executed` with `output: null` for some nodes (utility/audio
  // nodes, e.g. easy cleanGpuUsed in the LTX graph) — the type says otherwise.
  if (output == null) return null;
  const lines = output.text;
  if (!Array.isArray(lines)) return null;
  const joined = lines
    .filter((l): l is string => typeof l === 'string')
    .join('\n')
    .trim();
  return joined.length > 0 ? joined : null;
}

function summarize(msg: ComfyWsMessage): string {
  switch (msg.type) {
    case 'status':
      return `queue_remaining=${msg.data.status.exec_info.queue_remaining}`;
    case 'execution_start':
    case 'execution_cached':
    case 'execution_success':
      return `prompt=${msg.data.prompt_id.slice(0, 8)}`;
    case 'executing':
      return msg.data.node == null
        ? `prompt=${msg.data.prompt_id.slice(0, 8)} finished`
        : `node=${msg.data.node}`;
    case 'progress':
      return `${msg.data.value}/${msg.data.max} (node ${msg.data.node})`;
    case 'progress_state': {
      const running = Object.values(msg.data.nodes).filter(
        (n) => n.state === 'running',
      );
      return running.length
        ? `node ${running[0].node_id}: ${Math.round((running[0].value / running[0].max) * 100)}%`
        : `${Object.keys(msg.data.nodes).length} node(s)`;
    }
    case 'executed': {
      const images = msg.data.output?.images ?? [];
      return images.length
        ? images.map((i) => i.filename).join(', ')
        : `node=${msg.data.node}`;
    }
    case 'execution_error':
      return `${msg.data.node_type}: ${msg.data.exception_message.slice(0, 120)}`;
  }
}

/**
 * Keeps a WS connection to the current server while the calling component
 * is mounted. `onMessage` is optional: the global state (wsConnected,
 * queueRemaining, log) is updated in the store regardless.
 */
export function useComfyWs(onMessage?: (msg: ComfyWsMessage) => void) {
  const serverUrl = useSettings((s) => s.serverUrl);
  const clientId = useSettings((s) => s.clientId);
  const previewsEnabled = useSettings((s) => s.previewsEnabled);
  const hydrated = useSettings((s) => s.hydrated);
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!hydrated || !serverUrl) return;

    let ws: WebSocket | null = null;
    let disposed = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const { setWsConnected, setQueueRemaining, pushWsLog } =
      useConnection.getState();

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(createClient(serverUrl).wsUrl(clientId));
      ws.binaryType = 'arraybuffer'; // binary frames = sampler previews

      ws.onopen = () => {
        attempt = 0;
        setWsConnected(true);
        // Negotiation: declaring support for enriched previews MUST be the
        // first message (server.py only reads the flags at that point).
        // Previews disabled in Settings → the flag is not declared, so the
        // server does not emit the frames (zero bandwidth).
        if (previewsEnabled) {
          ws?.send(
            JSON.stringify({
              type: 'feature_flags',
              data: { supports_preview_metadata: true },
            }),
          );
        }
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') {
          // Binary frame: preview of the running sampler (event 1 or 4).
          if (!previewsEnabled) return;
          const preview = parsePreviewFrame(event.data as ArrayBuffer);
          if (preview) useExecution.getState().setPreview(preview);
          return;
        }
        let msg: ComfyWsMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!KNOWN_WS_TYPES.has(msg.type)) return; // crystools.monitor & co
        if (msg.type === 'status') {
          setQueueRemaining(msg.data.status.exec_info.queue_remaining);
        }
        useExecution.getState().applyWsMessage(msg);
        if (QUEUE_INVALIDATING_TYPES.has(msg.type)) {
          queryClient.invalidateQueries({ queryKey: ['queue'] });
        }
        // New image produced → refresh the gallery.
        if (msg.type === 'executed' || msg.type === 'execution_success') {
          queryClient.invalidateQueries({ queryKey: ['files'] });
          queryClient.invalidateQueries({ queryKey: ['history'] });
          queryClient.invalidateQueries({ queryKey: ['outputFiles'] });
        }
        // A text workflow just produced its prompt: bank it the moment it
        // exists, without waiting for anyone to open the result screen. The
        // server's /history is wiped on restart; the phone-side library is
        // not. `resolve` ignores jobs the library doesn't know (image jobs).
        if (msg.type === 'executed') {
          const text = textOutput(msg.data.output);
          if (text) {
            useGeneratedPrompts.getState().resolve(msg.data.prompt_id, text);
          }
        }
        // Local "job finished" notification (when the app is not active).
        if (msg.type === 'executed' && msg.data.output?.images?.length) {
          const list = outputsByPrompt.get(msg.data.prompt_id) ?? [];
          list.push(...(msg.data.output.images ?? []).map((i) => i.filename));
          outputsByPrompt.set(msg.data.prompt_id, list);
        } else if (msg.type === 'execution_success') {
          notifyJobDone(outputsByPrompt.get(msg.data.prompt_id) ?? []);
          outputsByPrompt.delete(msg.data.prompt_id);
        } else if (msg.type === 'execution_error') {
          notifyJobFailed(msg.data.node_type, msg.data.exception_message);
          outputsByPrompt.delete(msg.data.prompt_id);
        }
        pushWsLog(msg.type, summarize(msg));
        onMessageRef.current?.(msg);
      };

      ws.onerror = () => {
        // onclose always follows onerror: reconnection is handled there.
      };

      ws.onclose = () => {
        setWsConnected(false);
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
      setWsConnected(false);
      ws?.close();
    };
    // previewsEnabled in the deps: the toggle reconnects the WS to
    // renegotiate the flag with the server.
  }, [hydrated, serverUrl, clientId, previewsEnabled]);
}
