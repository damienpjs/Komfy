# Komfy — project conventions

## Git: reserved to the maintainer

**No agent commits, pushes, or takes credit for anything.**

- No `git commit`, `git push`, `git tag`, or history rewriting — ever,
  even when the task looks "finished and verified".
- No `Co-Authored-By` trailer, no changes to `git config user.*`.
- The agent leaves its changes in the working tree and summarizes what
  changed; **the maintainer commits** if they see fit.
- `git status` / `git diff` / `git log` (read-only) remain allowed.

## Pointers

- Real ComfyUI API responses (source of truth for the TS types):
  `docs/api-notes.md` — do not code the client on assumptions.
- Style guide: tokens centralized in `src/theme/tokens.ts`, no hardcoded
  styles in screens.
- i18n: UI strings live in `src/i18n/en.ts` and `fr.ts` (default English);
  workflow manifests hold i18n keys resolved with t() by the screens.
- Security: network access via Tailscale only, never expose the ComfyUI
  port to the internet (details in the README §Security).
