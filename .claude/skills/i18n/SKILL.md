---
name: i18n
description: Use whenever adding, renaming, or removing any user-facing UI string or workflow-manifest label in Komfy — keeps src/i18n/en.ts (source) and fr.ts in exact key parity and enforces the no-hardcoded-strings rule. Triggers on new visible text, i18n keys, translations, en/fr sync, "add a string", "traduction".
---

You are Komfy's i18n keeper. Two dictionaries must stay in perfect key
parity: [src/i18n/en.ts](../../../src/i18n/en.ts) is the **source** (default
language), [src/i18n/fr.ts](../../../src/i18n/fr.ts) is the translation. A key
present in en but missing in fr **falls back silently to English** — no error,
just a bug in French. Your job is to prevent that. **No git** (CLAUDE.md).

## Rules (from CLAUDE.md + the files' own headers)

- **No hardcoded user-facing strings** in screens/components. Any visible text
  goes through `t('namespace.key')`. Technical/language-neutral tokens
  ("euler", "Steps", filenames, seeds) may pass through `t()` unchanged.
- English is authored first, then translated to French. Same nesting, same key
  names, same order in both files.
- Plurals use i18next suffixes: define **both** `key_one` and `key_other`
  (see `queue.clearBody_one` / `_other`). Interpolation uses `{{count}}`,
  `{{node}}`, `{{message}}` — keep the same placeholders in fr.
- Workflow manifests reference keys under `wf.<shortId>.*` and `wf.common.*`;
  they are resolved by the screens with `t()`.

## Adding / changing strings

1. Add the key to **en.ts** in the right namespace (`common`, `tabs`, `queue`,
   `gallery`, `settings`, `wf.<id>`, …). Reuse `common.*` for generic verbs.
2. Add the **same key path** to **fr.ts** with the French translation.
3. Replace any literal in the screen/component with `t('…')` (import the hook
   the file already uses — match the surrounding code).

## Verify parity (run this after editing)

Extract and diff the leaf key sets of both dictionaries. Write the throwaway
script to the scratchpad — never into the repo:

```bash
cat > "$SCRATCH/i18n-parity.mjs" <<'EOF'
import en from '/Users/damien/Documents/Github/Komfy/src/i18n/en.ts';
import fr from '/Users/damien/Documents/Github/Komfy/src/i18n/fr.ts';
const leaves = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
  v && typeof v === 'object' ? leaves(v, p + k + '.') : [p + k]);
const E = new Set(leaves(en)), F = new Set(leaves(fr));
const only = (a, b) => [...a].filter(k => !b.has(k)).sort();
console.log('missing in fr:', only(E, F));
console.log('missing in en (stray):', only(F, E));
EOF
npx --yes tsx "$SCRATCH/i18n-parity.mjs"
```

Replace `$SCRATCH` with your session scratchpad path. Both lists must be empty.
If `tsx` can't run, fall back to opening the edited namespace in both files
side by side and mirroring every key by hand, then confirm counts match with
`grep -c "'" src/i18n/en.ts src/i18n/fr.ts` as a rough sanity check.

## Finish

Typecheck (`npx tsc --noEmit`) and report: keys added/changed, both parity
lists empty, any literals you converted to `t()`. Do not commit.
