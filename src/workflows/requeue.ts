/**
 * Remix v2: requeue of a raw graph (extracted from an image's metadata)
 * whose structure matches no embedded workflow. Nothing but the seeds is
 * patched — the graph is sent back as-is to /prompt.
 */

import type { PromptGraph } from '../api/types';
import { randomSeed } from './patch';

/** Seed inputs recognized in the ComfyUI ecosystem (KSampler & co). */
const SEED_INPUTS = ['seed', 'noise_seed'];

/**
 * Clones the graph and redraws every literal seed (`seed`/`noise_seed`) to
 * get a variant rather than an exact copy. Seeds wired to another node
 * (`[nodeId, output]` connection, e.g. via a "Seed Everywhere") are left
 * alone — they are not literals. Some custom nodes serialize their seeds
 * as strings ("16778260655371"): redrawn too, keeping the original type.
 * Returns the modified graph and the number of redrawn seeds (0 = none
 * found, identical requeue).
 */
export function withRandomSeeds(graph: PromptGraph): {
  graph: PromptGraph;
  seedsRandomized: number;
} {
  const clone: PromptGraph = JSON.parse(JSON.stringify(graph));
  let seedsRandomized = 0;
  for (const node of Object.values(clone)) {
    if (!node?.inputs) continue;
    for (const input of SEED_INPUTS) {
      const current = node.inputs[input];
      if (typeof current === 'number') {
        node.inputs[input] = randomSeed();
        seedsRandomized++;
      } else if (typeof current === 'string' && /^\d+$/.test(current)) {
        node.inputs[input] = String(randomSeed());
        seedsRandomized++;
      }
    }
  }
  return { graph: clone, seedsRandomized };
}
