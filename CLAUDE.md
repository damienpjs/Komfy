# Komfy — project conventions

## Git: the maintainer approves, then the agent writes

**The agent may branch and commit — but only after the maintainer has
approved the exact names.**

- **Propose before writing.** Announce the branch name, the commit
  message(s) and which files land in each, then wait for an explicit go —
  no silent commit, even when the task looks "finished and verified".
- Branches and commits follow Conventional Commits — `type/kebab-summary`
  and `type(scope): description` — see the `branch-name` and
  `conventional-commit` skills, which produce those names.
- A commit message is its subject line and nothing else: no body, no
  footer, no trailer.
- Work never lands directly on `develop` or `main`: branch first.
- A push follows the same rule as a commit: announce the exact refs, wait
  for the go, then push. An approval is never transitive — a go on a commit
  is not a go on a push, and a go on one push does not cover the next.
- Still reserved to the maintainer, with or without approval: `git tag` and
  any history rewriting (`rebase`, `commit --amend`, `reset --hard`,
  force-push).
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
