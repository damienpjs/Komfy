/**
 * Catch-up for the prompts still pending.
 *
 * The WS resolves a job's text the moment it is produced, but only while the
 * app is running: a job that finished with Komfy closed was never heard. On
 * mount, this reads /history for each pending job and fills in whatever
 * landed meanwhile — and forgets the jobs that will never produce anything.
 *
 * Runs once per mount rather than on a timer: it is the library's own
 * opening that needs the list correct, and live jobs are covered by the WS.
 */

import { useEffect } from 'react';
import { createClient } from '../api/client';
import { isPending, useGeneratedPrompts } from '../store/generatedPrompts';
import { useSettings } from '../store/settings';

/**
 * Past this age, a pending job that /history has never heard of is gone for
 * good (server restarted → history wiped) rather than merely queued: a text
 * job takes seconds. Only ever discards a placeholder, never a known text.
 */
const PENDING_TTL_MS = 60 * 60 * 1000;

export function usePendingPromptCatchUp() {
  const serverUrl = useSettings((s) => s.serverUrl);
  const hydrated = useSettings((s) => s.hydrated);

  useEffect(() => {
    if (!hydrated || !serverUrl) return;
    // Snapshot: whatever is pending at the moment the library opens. Reading
    // the store rather than subscribing keeps this out of the render loop.
    const pending = useGeneratedPrompts.getState().entries.filter(isPending);
    if (pending.length === 0) return;

    let cancelled = false;
    (async () => {
      const client = createClient(serverUrl);
      for (const entry of pending) {
        try {
          const res = await client.getHistoryItem(entry.promptId);
          if (cancelled) return;
          const item = res[entry.promptId];
          const store = useGeneratedPrompts.getState();

          if (!item) {
            // Still queued, or the server restarted and forgot it.
            if (Date.now() - entry.at > PENDING_TTL_MS) store.drop(entry.promptId);
            continue;
          }
          const text = entry.nodeId
            ? item.outputs?.[entry.nodeId]?.text?.join('\n').trim()
            : undefined;
          if (text) store.resolve(entry.promptId, text);
          else if (item.status?.completed != null) {
            // Finished and produced no text: it failed. Nothing to keep.
            store.drop(entry.promptId);
          }
        } catch {
          // Server unreachable: stay pending, retry next time the library
          // opens. The local entries themselves stay readable regardless.
          return;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [serverUrl, hydrated]);
}
