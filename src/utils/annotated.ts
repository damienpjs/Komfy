/**
 * ComfyUI annotated filenames. A loader input (LoadImage, LoadAudio,
 * LoadVideo) reads its file from the input folder, unless the name ends with
 * ` [output]` (or ` [temp]`): then it is resolved in that folder instead
 * (folder_paths.get_annotated_filepath, which strips the space too). Komfy
 * uses it to feed a gallery output straight into the next workflow, with no
 * download to the phone and no re-upload.
 */

export type FileRoot = 'input' | 'output' | 'temp';

export interface FileRef {
  filename: string;
  /** Relative to the root, '' at the root itself. */
  subfolder: string;
  type: FileRoot;
}

const ANNOTATION = /^(.*) \[(input|output|temp)\]$/;

/** The /view triple of a loader value, annotated or plain (input). */
export function parseAnnotated(value: string): FileRef {
  const m = ANNOTATION.exec(value);
  const path = m ? m[1] : value;
  const slash = path.lastIndexOf('/');
  return {
    filename: path.slice(slash + 1),
    subfolder: slash < 0 ? '' : path.slice(0, slash),
    type: m ? (m[2] as FileRoot) : 'input',
  };
}

/** Loader value pointing at a file of the output folder. */
export function outputRef(subfolder: string, filename: string): string {
  return `${subfolder ? `${subfolder}/` : ''}${filename} [output]`;
}

/** Loader value for an upload response (name + optional subfolder). */
export function inputRef(subfolder: string, name: string): string {
  return subfolder ? `${subfolder}/${name}` : name;
}

/**
 * Gallery listing path (`output/sub/clip.mp4`, komfy-listing) of a loader
 * value, annotated or plain (input).
 */
export function listingPath(value: string): string {
  const r = parseAnnotated(value);
  return `${r.type}/${r.subfolder ? `${r.subfolder}/` : ''}${r.filename}`;
}

/**
 * Loader value of a gallery listing path: `output/sub/a.png` →
 * `sub/a.png [output]`, `input/sub/a.png` → `sub/a.png` (the loaders'
 * default folder).
 */
export function loaderValue(path: string): string {
  const slash = path.indexOf('/');
  const root = path.slice(0, slash);
  const rel = path.slice(slash + 1);
  return root === 'input' ? rel : `${rel} [${root}]`;
}
