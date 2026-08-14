---
name: loop
description: Use when implementing a feature or fixing a bug in Komfy and the result should be challenged before it ships. Runs a dev pass, then objective gates (tsc, lint), then parallel adversarial `challenger` passes, then fixes — looping until nothing serious is left — and closes with a branch name, commit message(s) and a push proposal. Triggers on "/loop", "loop engineering", "boucle contradictoire", "contradicteur", "challenger", "implémente X avec la boucle", or any request to harden a change before committing. Not for scheduling something on a recurring interval — that is the unrelated built-in of the same name.
---

You are Komfy's loop engineer. A single dev pass is a first draft: it
compiles, it demoes, and it quietly breaks something three files away. This
skill replaces "implement, then declare victory" with "implement, then have
it attacked, then fix, then attack again".

Optional argument: the round cap. `/loop 5` allows five rounds;
with no argument, **3**.

## Hard rules (CLAUDE.md)

- **Never commit and never push during the loop.** The loop ends with a
  *proposal*; the maintainer gives the go. A go on a commit is not a go on
  a push.
- The `challenger` subagent is read-only. **It never fixes anything** —
  you do, so that a single mind stays responsible for the code.
- Never report the loop as clean when it isn't. Hitting the round cap with
  findings still open is a legitimate outcome — say so, plainly.

## The round

### 0. Dev pass (round 1 only)

Implement what was asked. Nothing special here, except: note in one line
what you *intended* to change — the challengers receive it, and an
objection is only meaningful against an intent.

### 1. Objective gates — before spending a single agent

```bash
npx tsc --noEmit     # baseline on develop: silent
npm run lint         # baseline on develop: 0 error, 1 known warning
```

Measured on `develop`: `tsc` says nothing, and `expo lint` reports exactly
one pre-existing warning — `src/i18n/index.ts:18`,
`import/no-named-as-default-member`. **Anything beyond that baseline is
yours**: don't chase the known warning, don't wave a new one through.

Deterministic and cheap, they catch what a reviewer should never have to.
Restore the baseline before going further — a challenger reading code
that does not compile burns a whole round for nothing.

### 2. Snapshot the diff

Write the round's full diff to the **session scratchpad, never inside the
repo** (a snapshot in the working tree would dirty `git status` and end up
reviewed as part of itself):

```bash
BASE=$(git merge-base HEAD develop)
git diff "$BASE"                                    # tracked changes
git status --porcelain -uall | awk '$1=="??"{print $2}'   # + read these in full
```

Always diff against the **base branch**, never against the previous round:
a round-2 fix can reintroduce what round 1 removed, and only the cumulative
diff shows it.

### 3. Challenger fan-out

Spawn `challenger` subagents **in parallel, one per lens**, each with:
the lens name, the snapshot path, and the one-line intent. Route lenses by
what the diff actually touches:

| Touched | Lens |
| --- | --- |
| *always* | `regression`, `correctness` |
| `src/api/**`, `src/workflows/**`, `server/**` | `server-contract` |
| `src/api/**`, `server/**`, `scripts/**`, network or settings code | `network-security` |
| `src/components/**`, `src/app/**`, `package.json` | `mobile-expo-go` |
| any user-facing string, any style | `conventions` |

Cap at **4 lenses per round**: the two mandatory ones plus the two most
relevant. More lenses is not more signal, it is more tokens.

### 4. Triage

Fix every `blocker` and every `major`. `minor` at your discretion, `nit`
only if it costs nothing.

**Every dismissed finding gets one written line of justification** — that
is the whole point of a challenger: it forces the disagreement into the
open instead of letting it be silently ignored. A dismissal without a
reason is not a dismissal, it is an oversight.

If a finding is wrong, say why it is wrong. Challengers are fallible;
verify before you obey, the same way they must verify before they claim.

### 5. Exit test

Loop again unless one of these holds:

- **Clean**: no `blocker` and no `major` remains, and the round produced
  none. This is the normal exit.
- **Idle round**: the round changed no code — nothing to re-attack.
- **Cap reached**: stop, and list what is still open with its severity.
  Do **not** dress this up as a success.

## Closing the loop

Once out, and only then:

1. Invoke [`branch-name`](../branch-name/SKILL.md) if HEAD is on `develop`
   or `main` — it wraps [`conventional-commit`](../conventional-commit/SKILL.md)
   and yields both names. On a feature branch, invoke `conventional-commit`
   alone.
2. Present, in this order:
   - the **loop journal**: per round, the findings by severity, what you
     fixed, what you dismissed and why;
   - the **branch name**, the **commit message(s)** and the files each
     covers;
   - the **push proposal**: the exact refs and their remote.
3. Wait. Creating the branch, committing and pushing each need their own
   explicit go.

## Journal format

Keep it short — the maintainer reads this to decide, not to admire the
process:

```
Round 1 · gates ok · regression 2 major, correctness 1 blocker, server-contract clean
  fixed    patch.ts:517 unguarded latentNodeId (blocker)
  fixed    match.ts:540 mask filename lost on remix (major)
  dismissed infer.ts:221 "mask never inferred" — deliberate, documented at types.ts:270
Round 2 · gates ok · all lenses clean → exit
```
