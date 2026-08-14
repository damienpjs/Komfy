---
name: branch-name
description: Use right after completing a task, when the current branch is develop or main. Detects the branch and — because work should not land directly on develop/main — proposes ONE English branch name (conventional-commit style, e.g. feat/tailscale-url-validation) alongside the commit name. Always proposes first and waits for the maintainer's explicit go before creating the branch or committing; never pushes, tags, or rewrites history.
---

You are Komfy's branch-namer. When a task finishes while HEAD is on a base
branch (`develop` or `main`), you tell the maintainer that the change should
live on its own branch, propose a name for it, and create it only once they
say go.

## Before doing anything: the hard rule ([CLAUDE.md](../../../CLAUDE.md))

**You never create a branch or commit unannounced.** Show the branch name,
the commit message(s) and the files each one covers, then wait for an
explicit go. Silence is not approval.

A push needs its own announcement and its own go. `git tag` and history
rewriting stay reserved to the maintainer entirely.

## When to run

Invoke this skill at the end of any task that touched the working tree, as a
companion to [`conventional-commit`](../conventional-commit/SKILL.md). Its
whole job is guarded by the branch check below:

1. Detect the current branch (read-only):

   ```bash
   git rev-parse --abbrev-ref HEAD
   ```

2. **If the branch is not `develop` or `main`** — the work is already on a
   feature branch. There is nothing to propose here; stop and let
   `conventional-commit` handle the commit name alone.
3. **If the branch is `develop` or `main`** — continue: the change should be
   moved onto its own branch. Proceed to propose a branch name.

## What to do (only on develop / main)

1. Read what changed — do not assume: `git status --short`, `git diff`,
   `git diff --cached`. Base the names on the actual diff, not the request.

2. Pick the dominant **type** — the same vocabulary as `conventional-commit`:
   `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
   `chore`.

3. Build **one** branch name, English:

   ```
   type/short-kebab-description
   ```

   - lowercase, words separated by single hyphens (kebab-case)
   - the description mirrors the commit subject, condensed to a few words
   - fold an obvious scope into the description
     (`feat/settings-tailscale-url-validation`), no parentheses
   - no trailing slash, no spaces, no `/` beyond the single type separator
   - keep it short — aim for ≤ 40 characters after the `type/`

4. Also produce the commit name via
   [`conventional-commit`](../conventional-commit/SKILL.md) so the two stay
   consistent (same type, same intent).

## Output

Present the branch name, the commit name and the files covered, then stop
and wait:

```
branch: feat/tailscale-url-validation
commit: feat(settings): add Tailscale URL validation
files:  src/store/settings.ts, src/components/SetupWizard.tsx
```

If the diff mixes clearly unrelated concerns, propose one branch + commit
per concern, and state the order they stack in (which branch is cut from
which) so the maintainer knows what to merge first.

## Creating the branch — only after the maintainer's go

```bash
git switch -c type/kebab-summary   # cut from the base branch, before staging
git add <exactly the files listed in the proposal>
git commit -m "type(scope): description"
```

- branch first, stage second: nothing ever gets committed on `develop` or
  `main` by accident
- a single `-m`: the subject line and nothing else — no body, no footer,
  no trailer
- leave HEAD on the new branch and report where the work sits; pushing and
  opening the PR need their own go
