/**
 * Gallery source, in order of preference:
 * 1. komfy-listing server extension (`GET /komfy/files`): full recursive
 *    listing of BOTH image roots (`output/…` and `input/…`), with mtime
 *    (recency sort). Every path is prefixed by its root — the tree's top
 *    level therefore holds the `output` and `input` folders.
 * 2. Fallback when the route is absent (404 — extension not installed or
 *    too old): tree rebuilt from GET /history (current session) + root
 *    files from GET /internal/files/output. Output-only (the input root
 *    needs the extension), still prefixed with `output/` for consistency.
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ComfyApiError, createClient } from '../api/client';
import { useSettings } from '../store/settings';

/** Root folders exposed at the top of the gallery tree. */
export type GalleryRoot = 'output' | 'input';

export interface GalleryImage {
  filename: string;
  /** Root this image lives in — selects the /view `type`. */
  root: GalleryRoot;
  /** Subfolder relative to `root` (no root prefix), for /view. */
  subfolder: string;
  /** Full prefixed path (root/subfolder/filename) — tree keys & selection. */
  path: string;
  /** Modification date (epoch s) when known — recency sort. */
  mtime?: number;
}

const HISTORY_MAX_ITEMS = 500;
const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

/** Splits a prefixed path into its root + a /view-ready (subfolder, filename). */
function toImage(path: string, mtime?: number): GalleryImage {
  const firstSlash = path.indexOf('/');
  const root = (firstSlash === -1 ? path : path.slice(0, firstSlash)) as GalleryRoot;
  const rest = firstSlash === -1 ? '' : path.slice(firstSlash + 1);
  const slash = rest.lastIndexOf('/');
  return {
    filename: slash === -1 ? rest : rest.slice(slash + 1),
    root,
    subfolder: slash === -1 ? '' : rest.slice(0, slash),
    path,
    mtime,
  };
}

export function useGallery() {
  const serverUrl = useSettings((s) => s.serverUrl);
  const hydrated = useSettings((s) => s.hydrated);
  const client = useMemo(() => createClient(serverUrl), [serverUrl]);

  const tree = useQuery({
    queryKey: ['files', client.baseUrl],
    enabled: hydrated && !!serverUrl,
    staleTime: 10_000,
    retry: false,
    queryFn: () => client.listFiles(),
  });

  // 404 → extension missing/too old: enable the fallback. Other errors
  // (offline, 503 volume) are handled by the global states.
  const treeMissing =
    tree.isError &&
    tree.error instanceof ComfyApiError &&
    tree.error.status === 404;

  const history = useQuery({
    queryKey: ['history', client.baseUrl],
    enabled: hydrated && !!serverUrl && treeMissing,
    staleTime: 10_000,
    queryFn: () => client.getHistory(HISTORY_MAX_ITEMS),
  });

  const rootFiles = useQuery({
    queryKey: ['outputFiles', client.baseUrl],
    enabled: hydrated && !!serverUrl && treeMissing,
    staleTime: 10_000,
    queryFn: () => client.listOutputFiles(),
  });

  // Empty folders (extension only): shown despite having no files —
  // otherwise a freshly created folder (or an empty root) would be invisible.
  const emptyDirs = useMemo(
    () => (tree.data ?? []).filter((e) => e.dir).map((e) => e.path),
    [tree.data],
  );

  const images = useMemo(() => {
    // Main source: the extension's full listing (paths already prefixed).
    if (tree.data) {
      return tree.data
        .filter((e) => !e.dir && IMAGE_RE.test(e.path))
        .map((e) => toImage(e.path, e.mtime));
    }

    // Fallback: session history + root files, forced under the output root.
    const byPath = new Map<string, GalleryImage>();
    for (const entry of rootFiles.data ?? []) {
      const match = entry.match(/^(.*) \[output\]$/);
      if (!match || !IMAGE_RE.test(match[1])) continue;
      const path = `output/${match[1]}`;
      byPath.set(path, toImage(path));
    }
    for (const entry of Object.values(history.data ?? {})) {
      for (const output of Object.values(entry.outputs)) {
        for (const image of output.images ?? []) {
          if (image.type !== 'output') continue;
          const rel = image.subfolder
            ? `${image.subfolder}/${image.filename}`
            : image.filename;
          const path = `output/${rel}`;
          if (!byPath.has(path)) byPath.set(path, toImage(path));
        }
      }
    }
    return [...byPath.values()];
  }, [tree.data, history.data, rootFiles.data]);

  return {
    images,
    paths: images.map((i) => i.path),
    /** Empty folder paths (extension), incl. the bare roots — for listDirectory. */
    emptyDirs,
    /** mtime per path, to sort the grids by recency. */
    mtimes: useMemo(
      () => new Map(images.map((i) => [i.path, i.mtime ?? 0])),
      [images],
    ),
    /** true = full listing (extension); false = session only. */
    fullListing: !!tree.data,
    isLoading: tree.isLoading || (treeMissing && (history.isLoading || rootFiles.isLoading)),
    isError: tree.isError && !treeMissing,
    refetch: async () => {
      await Promise.all([
        tree.refetch(),
        ...(treeMissing ? [history.refetch(), rootFiles.refetch()] : []),
      ]);
    },
    // `mtime` as the version: a file regenerated at the same path (SaveImage
    // counter reused after a deletion) gets a different URL → expo-image
    // reloads instead of serving the stale thumbnail.
    viewUrl: (image: GalleryImage) =>
      client.viewUrl(image.filename, image.subfolder, image.root, image.mtime),
  };
}
