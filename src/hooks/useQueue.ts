/**
 * Source of truth for the Queue screen: GET /queue polling (5 s without WS,
 * relaxed to 15 s when the WS is connected — WS events already invalidate
 * the query in real time), plus the control mutations.
 * Item deletion: optimistic update with rollback.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { createClient } from '../api/client';
import type { QueueEntry, QueueResponse } from '../api/types';
import i18n from '../i18n';
import { useConnection } from '../store/connection';
import { useSettings } from '../store/settings';

const POLL_MS = 5000;
const POLL_WS_MS = 15000;

/** Readable label for a job from its graph (checkpoint when present). */
export function describeGraph(graph: QueueEntry[2]): string {
  for (const node of Object.values(graph)) {
    if (node.class_type === 'CheckpointLoaderSimple') {
      const ckpt = node.inputs.ckpt_name;
      if (typeof ckpt === 'string') {
        return ckpt.replace(/\.(safetensors|ckpt)$/i, '');
      }
    }
  }
  return i18n.t('graph.nodeCount', { count: Object.keys(graph).length });
}

export function useQueue() {
  const serverUrl = useSettings((s) => s.serverUrl);
  const hydrated = useSettings((s) => s.hydrated);
  const wsConnected = useConnection((s) => s.wsConnected);
  const qc = useQueryClient();

  const client = useMemo(() => createClient(serverUrl), [serverUrl]);
  const queryKey = ['queue', client.baseUrl];

  const query = useQuery({
    queryKey,
    enabled: hydrated && !!serverUrl,
    queryFn: () => client.getQueue(),
    refetchInterval: wsConnected ? POLL_WS_MS : POLL_MS,
    retry: false,
  });

  const interrupt = useMutation({
    mutationFn: () => client.interrupt(),
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  const clearQueue = useMutation({
    mutationFn: () => client.clearQueue(),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<QueueResponse>(queryKey);
      if (prev) qc.setQueryData(queryKey, { ...prev, queue_pending: [] });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  const deleteItem = useMutation({
    mutationFn: (promptId: string) => client.deleteQueueItems([promptId]),
    onMutate: async (promptId) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<QueueResponse>(queryKey);
      if (prev) {
        qc.setQueryData(queryKey, {
          ...prev,
          queue_pending: prev.queue_pending.filter((e) => e[1] !== promptId),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  return { query, interrupt, clearQueue, deleteItem };
}
