/**
 * "File manager" view over a flat list of relative paths (LoRAs, output
 * images…). Pure logic, no RN dependency.
 */

export interface LoraDirEntry {
  kind: 'dir';
  name: string;
  /** Total number of files in the subtree. */
  count: number;
}

export interface LoraFileEntry {
  kind: 'file';
  name: string;
  /** Full path relative to the loras folder (value for lora_name). */
  path: string;
}

export type LoraEntry = LoraDirEntry | LoraFileEntry;

/** Filename without extension, for display. */
export function loraDisplayName(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.(safetensors|ckpt|pt)$/i, '');
}

/** Parent folder of a path ('' at the root). */
export function loraDirName(path: string): string {
  return path.split('/').slice(0, -1).join('/');
}

/**
 * Contents of a "folder": subfolders first, then files, sorted.
 * `extraDirs` = known folder paths without files (empty folders); those
 * that are direct children of `dir` are added with a count of 0.
 */
export function listDirectory(
  allPaths: string[],
  dir: string,
  extraDirs: string[] = [],
): LoraEntry[] {
  const prefix = dir === '' ? '' : `${dir}/`;
  const dirs = new Map<string, number>();
  const files: LoraFileEntry[] = [];

  for (const path of allPaths) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) {
      files.push({ kind: 'file', name: rest, path });
    } else {
      const sub = rest.slice(0, slash);
      dirs.set(sub, (dirs.get(sub) ?? 0) + 1);
    }
  }

  for (const d of extraDirs) {
    if (!d.startsWith(prefix)) continue;
    const rest = d.slice(prefix.length);
    if (rest === '' || rest.includes('/')) continue; // not a direct child
    if (!dirs.has(rest)) dirs.set(rest, 0);
  }

  const compare = (a: string, b: string) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' });
  return [
    ...[...dirs.entries()]
      .sort(([a], [b]) => compare(a, b))
      .map(([name, count]): LoraDirEntry => ({ kind: 'dir', name, count })),
    ...files.sort((a, b) => compare(a.name, b.name)),
  ];
}

/** Recursive (case-insensitive) search on the full path. */
export function searchLoras(
  allPaths: string[],
  query: string,
): LoraFileEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return allPaths
    .filter((p) => p.toLowerCase().includes(q))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((path) => ({
      kind: 'file',
      name: path.split('/').pop() ?? path,
      path,
    }));
}
