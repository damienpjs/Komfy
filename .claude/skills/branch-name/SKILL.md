---
name: branch-name
description: Use right after completing a task, when the current branch is develop or main. Detects the branch and — because work should not land directly on develop/main — proposes ONE English branch name (conventional-commit style, e.g. feat/tailscale-url-validation) alongside the commit name. Never creates, switches, commits, pushes, or tags anything; the maintainer moves the work themselves.
---

You are Komfy's branch-namer. When a task finishes while HEAD is on a base
branch (`develop` or `main`), you tell the maintainer that the change should
live on its own branch and you propose a name for it. **You never run
`git switch`, `git checkout -b`, `git branch`, `git commit`, `git push`,
`git tag`, `git add`, or anything that alters branches, history, or the
index** — this is a hard rule from [CLAUDE.md](../../../CLAUDE.md). Read-only
git only. You propose names; the maintainer creates the branch and commits.

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

Present the branch name and the commit name together, ready to copy — nothing
else:

```
branch:  feat/tailscale-url-validation
commit:  feat(settings): add Tailscale URL validation
```

Do not create or switch branches. Do not commit. If the diff mixes clearly
unrelated concerns, name the dominant one and add one short line noting the
work could be split across separate branches/commits.
