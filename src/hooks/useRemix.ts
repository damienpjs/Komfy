/**
 * Image remix (Sprint 4b): retrieves an output image's "recipe" (API
 * graph) then matches it against the embedded workflows.
 * 1. downloads the PNG via /view and reads the `prompt` tEXt chunk on the
 *    app side (parser in src/utils/pngMetadata.ts) — the file bytes are
 *    the ground truth;
 * 2. otherwise (non-PNG file, /view failed): GET /history. ⚠️ After a
 *    deletion, SaveImage reuses its counters: several jobs of the session
 *    can carry the same path — take the most recent one.
 */

import { fetch } from 'expo/fetch';
import { useMemo } from 'react';
import { createClient } from '../api/client';
import { queryClient } from '../api/queryClient';
import type { PromptGraph } from '../api/types';
import { useSettings } from '../store/settings';
import { parsePngText } from '../utils/pngMetadata';
import { matchGraph, type SourceSeeds } from '../workflows/match';
import { allWorkflows } from '../workflows/registry';
import { withRandomSeeds } from '../workflows/requeue';
import type { FieldValues } from '../workflows/types';
import type { GalleryImage } from './useGallery';

/**
 * `unknown-workflow` carries the raw graph: its recipe is readable but
 * matches no embedded workflow → requeueable as-is (Remix v2).
 */
export type RemixResult =
  | {
      status: 'match';
      manifestId: string;
      values: FieldValues;
      /** Seed(s) the image was drawn with — offered back by the form. */
      sourceSeeds: SourceSeeds;
    }
  | { status: 'unknown-workflow'; graph: PromptGraph }
  | { status: 'no-metadata' };

async function graphFromHistory(
  baseUrl: string,
  image: GalleryImage,
): Promise<PromptGraph | null> {
  const client = createClient(baseUrl);
  const history = await queryClient.fetchQuery({
    queryKey: ['history', client.baseUrl],
    queryFn: () => client.getHistory(500),
    staleTime: 10_000,
  });
  // Last matching job: /history insertion order is chronological and a
  // path may have been reused after a deletion.
  let found: PromptGraph | null = null;
  for (const entry of Object.values(history)) {
    if (!entry.prompt) continue;
    for (const output of Object.values(entry.outputs)) {
      // Native SaveVideo lists the .mp4 under `images` (verified on the live
      // server); VideoHelperSuite combines use `gifs` — scan both so a video
      // remixes from history the same way a still does.
      for (const img of [...(output.images ?? []), ...(output.gifs ?? [])]) {
        if (
          img.type === 'output' &&
          img.filename === image.filename &&
          img.subfolder === image.subfolder
        ) {
          found = entry.prompt[2];
        }
      }
    }
  }
  return found;
}

async function graphFromPng(
  baseUrl: string,
  image: GalleryImage,
): Promise<PromptGraph | null> {
  // `mtime` as the version: prevents an HTTP cache from serving the stale
  // PNG of a file regenerated at the same path (→ wrong extracted recipe).
  const url = createClient(baseUrl).viewUrl(
    image.filename,
    image.subfolder,
    image.root,
    image.mtime,
  );
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on /view`);
  const chunks = parsePngText(await res.arrayBuffer());
  if (!chunks.prompt) return null;
  try {
    return JSON.parse(chunks.prompt) as PromptGraph;
  } catch {
    return null;
  }
}

/** PNG chunk first (ground truth), /history as the fallback. */
async function extractGraph(
  serverUrl: string,
  image: GalleryImage,
): Promise<PromptGraph | null> {
  let graph: PromptGraph | null = null;
  if (/\.png$/i.test(image.filename)) {
    try {
      graph = await graphFromPng(serverUrl, image);
    } catch {
      // /view failed: still try /history.
    }
  }
  if (!graph) {
    graph = await graphFromHistory(serverUrl, image);
  }
  return graph;
}

export function useRemix() {
  const serverUrl = useSettings((s) => s.serverUrl);
  const clientId = useSettings((s) => s.clientId);

  return useMemo(
    () => ({
      /**
       * Raw recipe of an item, without matching — what the details sheet
       * renders (seed, model, prompts…). null = no readable metadata.
       */
      graphOf: (image: GalleryImage): Promise<PromptGraph | null> =>
        extractGraph(serverUrl, image),

      /** Throws on network error; otherwise a typed result. */
      extract: async (image: GalleryImage): Promise<RemixResult> => {
        const graph = await extractGraph(serverUrl, image);
        if (!graph) return { status: 'no-metadata' };
        const outcome = matchGraph(graph, allWorkflows());
        if (outcome.status === 'unknown-workflow') {
          return { status: 'unknown-workflow', graph };
        }
        return outcome;
      },

      /**
       * Remix v2: requeues a raw graph with new seeds (variant).
       * Returns the job number returned by /prompt.
       */
      requeue: async (graph: PromptGraph): Promise<number> => {
        const { graph: withSeeds } = withRandomSeeds(graph);
        const res = await createClient(serverUrl).postPrompt(withSeeds, clientId);
        return res.number;
      },
    }),
    [serverUrl, clientId],
  );
}
