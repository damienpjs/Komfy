/**
 * Standard / GGUF switch of a `model` field (ModelField.variantSwitch): which
 * file each side stands for, picked from the server's own filtered list.
 */

export type ModelVariant = 'standard' | 'gguf';

export const isGgufFile = (path: string) => /\.gguf$/i.test(path);

export const variantOf = (file: string): ModelVariant =>
  isGgufFile(file) ? 'gguf' : 'standard';

/**
 * File the switch selects for `variant`. Keeps `current` when it already
 * belongs to that side; otherwise the field default (standard side), or a
 * Q8_0 file, the closest to bf16 (GGUF side); else the first file of the
 * side. Degraded mode (no server list): only the frozen default is known.
 * undefined = no file of that side on the server (the switch disables it).
 */
export function pickVariantFile(
  variant: ModelVariant,
  options: string[] | undefined,
  current: string,
  defaultFile: string,
): string | undefined {
  if (!options) {
    return variantOf(defaultFile) === variant ? defaultFile : undefined;
  }
  const side = options.filter((f) => variantOf(f) === variant);
  if (side.length === 0) return undefined;
  if (side.includes(current)) return current;
  if (side.includes(defaultFile)) return defaultFile;
  if (variant === 'gguf') {
    const q8 = side.find((f) => /q8/i.test(f));
    if (q8) return q8;
  }
  return side[0];
}
