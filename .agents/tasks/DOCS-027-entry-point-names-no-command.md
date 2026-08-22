---
title: 'DOCS-027: the entry point routes 105 npm scripts by pointer alone, so the handful the rules require every session costs a discovery turn'
status: todo
created: 2026-08-22
priority: medium
urgency: later
area: AGENTS.md, .agents/rules/verification.md, scripts/harness/
depends_on: []
---

# DOCS-027: naming the session-critical commands at the entry point

## Problem

`AGENTS.md` routes every command to `package.json` and names none:

> Commands live in the root `package.json` `scripts` — run `pnpm run` to list them, including every
> `harness:*` entry point.

Routing is the file's stated design ("it routes, and it does not inline", `AGENTS.md:5-6`), and the
reason is real: every line is re-injected after every compaction and paid on every turn.

The cost falls on the other side. An agent that needs the verification command cannot get it from the
auto-loaded context; it must spend a turn on `pnpm run`, which prints **213 lines for 105 scripts**
(66 of them `harness:*`). That turn buys the same small set of commands each time, because the rules
themselves converge on a stable handful — counted across `.agents/rules/*.md`:

| Command                    | Times named in the rules |
| -------------------------- | ------------------------ |
| `pnpm harness:scan`        | 8                        |
| `pnpm harness:pre-push`    | 5                        |
| `pnpm build`               | 4                        |
| `pnpm test`                | 2                        |
| `pnpm harness:verify`      | 2                        |
| `pnpm harness:conformance` | 2                        |

So the fact is already duplicated — 23+ times, across rule files that are not auto-loaded — while the
one document that IS auto-loaded carries none of it.

## Why this is filed rather than fixed in place

`AGENTS.md` § Mandatory Rules: an argument against a rule is the input to an amendment, never an
exemption, and the minimum evidence that an amendment was attempted is a filed backlog item. This is
that item. The routing sentence stays as written until this is decided.

## What the constraint actually is

Worth stating precisely, because it is weaker than it first reads. The prohibition `read them there,
never from a copy` (`AGENTS.md:50`) attaches to **toolchain versions**, not to commands — versions
have a scan (`node-version-single-valued`) enforcing the single value. The commands sentence carries
no such prohibition. What binds an inline command list is only the general pair:

- `it routes, and it does not inline` (`AGENTS.md:6`)
- `Never duplicate content across levels. Each fact has exactly one owner document.` (`AGENTS.md:18`)

Both are about drift and per-turn cost, and both are satisfiable by a derived copy that cannot drift.

## Directions considered

1. **Status quo.** Keep the pointer. Zero added lines; every session keeps paying the discovery turn,
   and the 23 existing copies in the rules stay unguarded.
2. **Hand-written block in `AGENTS.md`.** Cheapest to write, and the one direction the principles
   genuinely refuse: a hand-copied list has no owner and drifts silently, which is the failure
   `Each fact has exactly one owner document` exists to prevent.
3. **Derived block, mechanically guarded.** `AGENTS.md` carries a short generated block; a harness
   scan fails when the block and `package.json` disagree. The fact keeps one owner (`package.json`);
   the entry point carries a copy that cannot go stale. This is the pattern the repo already uses —
   `hook-override-declarations` derives a hook's accepted override forms from the hook source rather
   than trusting a hand-written declaration.
4. **Name the keys only.** List the script KEYS (`build`, `test`, `harness:scan`, `harness:pre-push`)
   without command bodies. Six words, no bodies to drift; still a hand-maintained set, and a renamed
   script leaves it wrong with nothing failing.

## Recommendation

Direction 3, scoped to the commands the rules already require — the six in the table above — and no
more. It resolves the tension rather than trading one side away: the entry point stops costing a
discovery turn, and the guard makes the copy unable to disagree with its owner. Direction 4 is the
fallback if the scan is judged more machinery than the saving is worth.

The decision belongs to the owner; this item does not presume it.

## Test Plan

- New scan added under `scripts/harness/`, registered in `run-all-scans.mjs`, with a test that it
  goes RED when the block and `package.json` disagree (a generated block whose guard cannot fail is
  the same defect one layer up — `HARNESS-101`, `wiring-guardian`).
- `pnpm harness:scan` green.
- `pnpm harness:test:contracts` green.
- Prove the guard fires: mutate one command in the block, confirm the scan exits non-zero, restore.

## User Execution Test Scenarios

Not applicable — documentation/governance change only; it delivers no runnable user-facing behavior.
Verification is the harness scan in `## Test Plan`, per `.agents/tasks/README.md` (documentation-only
and governance-only changes must not invent a user execution test scenario).
