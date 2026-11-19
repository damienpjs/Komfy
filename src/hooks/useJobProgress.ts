/**
 * Progress of the running job as the card and the live preview show it:
 * percentage, steps, elapsed time and the estimate of the time left.
 * Fine progress only exists for jobs Komfy queued (WS routing by sid);
 * otherwise `fine` is false and only the elapsed time is known.
 */

import { useEffect, useRef, useState } from 'react';
import { useExecution } from '../store/execution';

export interface JobProgress {
  /** The WS events of this job reach the app. */
  isOurs: boolean;
  /** Sampler steps known: percent and steps are meaningful. */
  fine: boolean;
  percent: number | null;
  value: number;
  max: number;
  /** Current node id, when known. */
  node: string | null;
  elapsedMs: number;
  /** Seconds left at the current rate, null until measurable. */
  etaSec: number | null;
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function formatEta(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} s`;
  return formatClock(s * 1000);
}

/** `promptId` null: the job Komfy follows, whichever it is. */
export function useJobProgress(promptId: string | null): JobProgress {
  const exec = useExecution();
  const id = promptId ?? exec.promptId;
  const isOurs = id != null && exec.promptId === id;

  // Elapsed time: WS timestamp when the job is ours, else since the first
  // time the app saw this prompt_id (lower-bound approximation).
  const firstSeenRef = useRef<{ id: string | null; at: number }>({ id, at: Date.now() });
  if (firstSeenRef.current.id !== id) firstSeenRef.current = { id, at: Date.now() };
  const since = isOurs && exec.startedAt ? exec.startedAt : firstSeenRef.current.at;

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ETA: average rate (steps/s) since the first measured step of the current
  // node, extrapolated to the remaining steps; resets on every node change
  // or sampler reset.
  const etaRef = useRef<{ key: string; at: number; value: number } | null>(null);
  let etaSec: number | null = null;
  if (isOurs && exec.max > 0 && exec.value > 0) {
    const key = `${id}:${exec.node}`;
    const anchor = etaRef.current;
    if (!anchor || anchor.key !== key || exec.value < anchor.value) {
      etaRef.current = { key, at: now, value: exec.value };
    } else if (exec.value > anchor.value && now > anchor.at) {
      const rate = (exec.value - anchor.value) / ((now - anchor.at) / 1000);
      if (rate > 0) etaSec = (exec.max - exec.value) / rate;
    }
  } else if (isOurs && exec.value === 0) {
    etaRef.current = null;
  }

  const fine = isOurs && exec.max > 0;
  return {
    isOurs,
    fine,
    percent: fine ? Math.min(100, Math.round((exec.value / exec.max) * 100)) : null,
    value: isOurs ? exec.value : 0,
    max: isOurs ? exec.max : 0,
    node: isOurs ? exec.node : null,
    elapsedMs: now - since,
    etaSec,
  };
}
