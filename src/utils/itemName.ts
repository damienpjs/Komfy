/**
 * Rules for a Library file or folder name, mirroring komfy-listing's
 * name_problem() so the rename dialog can explain a refusal before sending
 * anything. The server stays the authority. Pure logic, no RN dependency.
 */

/** Why a name is refused: see nameProblem(). */
export type NameProblem = 'empty' | 'dot' | 'chars' | 'long';

/** APFS / ext4 limit for one name, in UTF-8 bytes. */
const MAX_NAME_BYTES = 255;

function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * Why `name` (already trimmed) cannot name a file or folder, or null when
 * it can. A rename never moves, so no path separator; a leading dot would
 * hide the item from the listings; ':' is refused like the output-folder
 * sanitizer does.
 */
export function nameProblem(name: string): NameProblem | null {
  if (name === '') return 'empty';
  if (name.startsWith('.')) return 'dot';
  for (const ch of name) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 32 || c === 127 || ch === '/' || ch === '\\' || ch === ':') {
      return 'chars';
    }
  }
  if (utf8Length(name) > MAX_NAME_BYTES) return 'long';
  return null;
}

/**
 * Splits a file name into its stem and extension (dot included), like
 * Python's os.path.splitext: `a.tar.gz` → [`a.tar`, `.gz`], a leading dot
 * alone is not an extension.
 */
export function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return [name, ''];
  return [name.slice(0, dot), name.slice(dot)];
}
