/**
 * Best-effort auto-coupling for the generalist modelSource field: when a
 * diffusion model is chosen, guess its CLIP encoder type + a matching CLIP
 * and VAE file from the server's OWN /object_info enums, by lexical family
 * matching on the filenames. Purely generic — no model name or preset table
 * is baked into the app; the guesses only ever come from the connected
 * server's lists, and the user overrides any of them in the form.
 */

/** Lowercased alphanumeric tokens of a name (`qwen_image_2512` → qwen/image/2512). */
function tokens(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Two tokens belong to the same family if one is a prefix of the other. */
function tokenMatch(a: string, b: string): boolean {
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/**
 * Guesses the CLIPLoader `type` for a diffusion model: the enum value whose
 * every token appears in the model filename, preferring the most specific
 * (most tokens) match. Returns undefined when nothing matches confidently —
 * the caller then keeps the current value rather than guess wrong.
 */
export function guessClipType(
  modelName: string,
  clipTypes: string[] | undefined,
): string | undefined {
  if (!clipTypes || clipTypes.length === 0) return undefined;
  const modelTokens = tokens(modelName);
  let best: string | undefined;
  let bestScore = 0;
  for (const type of clipTypes) {
    const typeTokens = tokens(type);
    if (typeTokens.length === 0) continue;
    const allMatch = typeTokens.every((tt) =>
      modelTokens.some((mt) => tokenMatch(mt, tt)),
    );
    // Prefer the type with the most matched tokens (e.g. `qwen_image` over a
    // hypothetical single-token `qwen`), ties keep the first encountered.
    if (allMatch && typeTokens.length > bestScore) {
      best = type;
      bestScore = typeTokens.length;
    }
  }
  return best;
}

/**
 * Guesses a companion file (CLIP or VAE) for a diffusion model: the file
 * sharing the most family tokens with the chosen CLIP type and the model
 * name. Short/numeric tokens (bf16, fp8…) are ignored so precision families
 * don't outweigh the architecture. Returns undefined when no file shares a
 * meaningful token — the caller keeps its current value.
 */
export function guessCompanionFile(
  modelName: string,
  clipType: string | undefined,
  files: string[] | undefined,
): string | undefined {
  if (!files || files.length === 0) return undefined;
  // Family hints, most trustworthy first: the CLIP type, then the model name.
  // Drop generic precision/format tokens that match too many files.
  const noise = new Set([
    'bf16',
    'fp16',
    'fp8',
    'fp32',
    'e4m3fn',
    'e5m2',
    'scaled',
    'fast',
    'safetensors',
    'pruned',
    'turbo',
    'dev',
    'default',
    'model',
  ]);
  const wanted = [...tokens(clipType ?? ''), ...tokens(modelName)].filter(
    (w) => w.length >= 3 && !noise.has(w),
  );
  if (wanted.length === 0) return undefined;
  let best: string | undefined;
  let bestScore = 0;
  for (const file of files) {
    const fileTokens = tokens(file);
    let score = 0;
    for (const w of wanted) {
      if (fileTokens.some((ft) => tokenMatch(ft, w))) score++;
    }
    if (score > bestScore) {
      best = file;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : undefined;
}
