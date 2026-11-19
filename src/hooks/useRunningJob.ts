/**
 * The running job as the shell shows it everywhere (status chip, mini
 * player): its title, its progress when Komfy submitted it, the pending count
 * and the latest sampler preview. Fine progress only exists for Komfy jobs
 * (the WS routes `progress` to the submitting sid); a job queued elsewhere
 * reports `fraction: null`.
 */

import type { WsPreview } from '../utils/wsPreview';
import { useConnection } from '../store/connection';
import { useExecution } from '../store/execution';
import { jobTitle, useQueue } from './useQueue';

export interface RunningJob {
  promptId: string;
  title: string;
  /** 0–1 when Komfy follows the sampler, null otherwise. */
  fraction: number | null;
  value: number;
  max: number;
  preview: WsPreview | null;
}

export function useRunningJob(): {
  job: RunningJob | null;
  pending: number;
} {
  const { query } = useQueue();
  const queueRemaining = useConnection((s) => s.queueRemaining);
  const execPromptId = useExecution((s) => s.promptId);
  const value = useExecution((s) => s.value);
  const max = useExecution((s) => s.max);
  const preview = useExecution((s) => s.preview);

  const pending = query.data?.queue_pending.length ?? queueRemaining ?? 0;
  const entry = query.data?.queue_running[0];
  if (!entry) return { job: null, pending };

  const [, promptId, graph] = entry;
  const ours = execPromptId === promptId;
  return {
    pending,
    job: {
      promptId,
      title: jobTitle(promptId, graph),
      fraction: ours && max > 0 ? Math.min(1, value / max) : null,
      value: ours ? value : 0,
      max: ours ? max : 0,
      preview: ours ? preview : null,
    },
  };
}
