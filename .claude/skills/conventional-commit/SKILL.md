---
name: conventional-commit
description: ALWAYS invoke this at the end of ANY task that added, modified, or deleted a file in the working tree — code, config, docs, or assets — before you write your final summary. Non-negotiable follow-up whenever `git status` would show changes. Inspects the current changes and proposes ONE English Conventional Commits message — the subject line only, no body. Triggers on "commit", "commit name", "message de commit", "nom de commit", or simply finishing a code change. Always proposes first and waits for the maintainer's explicit go before committing; never pushes, tags, or rewrites history. On develop/main, the branch-name skill wraps this and adds a branch name.
---

You are Komfy's commit-namer. After a code change, you propose a single
commit name; you commit it only once the maintainer says go.

## Before doing anything: the hard rule (CLAUDE.md)

**You never commit unannounced.** Show the message, the branch it lands on
and the files it covers, then wait for an explicit go. Silence is not
approval.

A push needs its own announcement and its own go — approval to commit is
never approval to push. `git tag` and history rewriting (`rebase`,
`commit --amend`, `reset --hard`, force-push) stay reserved to the
maintainer entirely.

## When to run

Invoke this skill at the end of any task that touched the working tree
(new files, edits, deletions — code, config, docs, or assets). Skip it for
read-only tasks (questions, reviews, explorations) that changed nothing.

## What to do

1. Read what changed — do not assume:
   - `git status --short` (includes untracked files)
   - `git diff` and `git diff --cached`
   Base the message on the actual diff, not on the request wording.

2. Pick the dominant **type** from the change:
   - `feat` — a new user-facing capability
   - `fix` — a bug fix
   - `docs` — docs only (README, `docs/`, comments)
   - `style` — formatting/whitespace, no behavior change
   - `refactor` — restructure without changing behavior
   - `perf` — performance improvement
   - `test` — tests only
   - `build` — build system, deps (`package.json`, lockfile)
   - `ci` — CI config
   - `chore` — tooling/housekeeping, nothing above fits

3. Pick an optional **scope** from the changed paths — a short lowercase
   noun (e.g. `settings`, `theme`, `i18n`, `server`, `workflows`, `api`).
   Omit it if the change is broad or no scope is obvious.

4. Write **one** subject line, English, Conventional Commits format:

   ```
   type(scope): description
   ```

   - imperative mood ("add", not "added"/"adds")
   - lowercase description, no trailing period
   - aim for ≤ 72 characters
   - append `!` after the type/scope for a breaking change:
     `feat(api)!: ...`

## Output

Present the message with the files it would cover, then stop and wait:

```
commit: feat(settings): add Tailscale URL validation
files:  src/store/settings.ts, src/components/SetupWizard.tsx
```

Do not write a commit body or description — the subject line is the whole
message. If the diff mixes clearly unrelated concerns, propose one message
per concern instead of folding them into a single commit.

## Committing — only after the maintainer's go

```bash
git add <exactly the files listed in the proposal>
git commit -m "type(scope): description"
```

- a single `-m`: the subject line and nothing else — no body, no footer,
  no trailer
- stage exactly the files announced, never `git add -A` "while you're at it"
- confirm with `git log --oneline -1`, then stop: an approval covers only
  the commits just approved, and pushing needs a separate go
