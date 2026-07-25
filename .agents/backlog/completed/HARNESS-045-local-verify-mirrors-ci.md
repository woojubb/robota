---
title: 'HARNESS-045: a single local verification entry that reproduces the CI scans/quality gate exactly'
status: done
created: 2026-07-25
completed: 2026-07-25
priority: high
urgency: soon
area: scripts/harness, package.json, .agents/skills, .agents/rules
depends_on: []
---

# HARNESS-045: local verification must mirror what CI asserts

## The class

An agent's FOREGROUND verification — typically `node scripts/harness/run-all-scans.mjs` reported as
"green locally" — does NOT reproduce what the CI `scans` / `quality` jobs assert. So "green locally"
is not the same claim as "green in CI," and an agent can honestly report a passing local run while the
PR fails CI. This is a recurring **agent/technical failure class** (the same kind of "green
locally → red in CI" failure fixed more than once), which is exactly the blind spot the
[lesson-to-harness](../skills/lesson-to-harness/SKILL.md) recurring-failure mining scope now targets.
The terminal state for a recurring mistake is a mechanical prevention, not another one-off fix.

## Evidence (cited instances of the class)

- **Spec-surface baseline false-pass.** The spec-surface scan treats a below-baseline count as a
  pass locally ("below-baseline → tighten"), so a real improvement reads as green in a foreground
  run. But the CI self-test asserts `notices == []`, so the same state fails in CI. Observed on
  #1346 and #1357.
- **Prettier-wrapped multi-line arrays.** Prettier (the repo's SSOT formatter, run via lint-staged)
  wraps a long YAML `tags` array onto multiple lines, but `check-spec-doc-frontmatter` only parses the
  single-line form, so it reports "tags missing." A `--no-verify` push from a fresh worktree skips
  prettier entirely, so the drift is never produced — and never caught — locally. Observed on
  #1369 → tracked as **HARNESS-044** (the frontmatter-parser sub-fix; a member of this class).

## Root cause

1. The local run treats **baseline notices** (below-baseline spec-surface) and **unbuilt `dist`** as
   a pass, whereas CI self-tests assert `notices == []` and run scans against the built `dist`.
2. **Fresh worktrees lack the husky / prettier toolchain**, so a `--no-verify` push bypasses
   formatting; formatter-induced drift (e.g. multi-line arrays) is never generated locally and thus
   never exercised by the local scans.

Net: the foreground gate and the CI gate assert different things, so a green local run gives false
assurance.

## Prevention to build (the mechanism)

A single `pnpm` verification entry — e.g. `pnpm harness:verify-like-ci` — that reproduces the CI gate
exactly, so an agent's self-verification catches these BEFORE push:

1. Runs the harness **self-test suite** (so the spec-surface baseline assertion `notices == []`
   trips locally instead of silently passing below-baseline).
2. Runs a **prettier `--check`** over the changed files (so formatter-induced drift — multi-line
   arrays, wrapping — is surfaced even on a fresh worktree that would otherwise `--no-verify`).
3. Runs the scans against the **built `dist`** (so unbuilt-`dist` no longer masks a failure).

Then wire a reference to this single entry into:

- the parallel-orchestration skill's verification step (agents self-verify with the CI-equivalent
  command, not bare `run-all-scans`); and
- the `git-branch.md` pre-merge guidance (the pre-push / pre-merge check is the CI-equivalent entry).

## Why this was deferred (resolved — ARCH-005 S1 landed as #1376, unblocking the work)

The mechanism lives in `scripts/harness/**`, which is currently **contended by another active agent**
(ARCH-005 S1 is editing `scripts/harness`). Building the new entry now would conflict. Coordinate:
**build this AFTER ARCH-005 S1 merges** to avoid stepping on its in-flight changes. This is a
scheduling obstacle, not a design blocker — hence a tracked backlog item rather than silence, which
is the sanctioned "infeasible-now + tracked backlog" terminal state.

## Red-first plan (per lesson-to-harness step 9)

1. Reproduce a **below-baseline spec-surface improvement** and a **prettier-wrapped multi-line array**
   in a fixture.
2. Show `node scripts/harness/run-all-scans.mjs` reports GREEN on both while the new
   `harness:verify-like-ci` entry FAILS (it asserts `notices == []`, runs prettier `--check`, and
   scans the built `dist`).
3. After the fix / formatting, show the new entry PASSES. Record the before/after result.

## Test Plan

- Fixture-based red/green pair for each cited instance (below-baseline spec-surface; prettier-wrapped
  tags), demonstrating the new entry FAILS where `run-all-scans` passed, then PASSES after fix.
- Register the new entry so CI and the local run assert the same thing; `pnpm harness:test` +
  `run-all-scans` green.

## User Execution Test Scenarios

- Not applicable (harness / CI-parity check; governance-only change with no runnable user-facing
  behavior). Evidence: the fixture red/green pairs above, run by the agent.

## Outcome (done 2026-07-25)

**Built:** `pnpm harness:verify-like-ci` → `scripts/harness/verify-like-ci.mjs` (+ 23-case unit suite in
`scripts/harness/__tests__/verify-like-ci.test.mjs`). Four stages, each **derived from the real
definition** (`.github/workflows/ci.yml`, `.lintstagedrc.json`) and printed with the definition it
mirrors, so a failure names its own fix target:

| Stage               | Mirrors                                                                              | What a bare `run-all-scans` misses                                            |
| ------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `harness-self-test` | ci.yml → `scans` → "Harness scan test suite" (`pnpm harness:test`)                   | baseline TIGHTNESS (`notices == []`) — a below-baseline count is a local pass |
| `format-check`      | `.lintstagedrc.json` globs via `.husky/pre-commit` (prettier)                        | a `--no-verify` push from a fresh worktree never runs the SSOT formatter      |
| `scan-suite`        | ci.yml → `scans` "Harness scan suite" + `quality` "Build-output contracts" (w/ dist) | the dist-dependent scans silently no-op on an unbuilt tree                    |
| `typecheck`         | ci.yml → `quality` → `harness:verify` (typecheck step)                               | the scan suite never typechecks                                               |

No stage is skipped after an earlier failure (a new failure must never hide behind a known one). The
formatter file set is **derived** from `.lintstagedrc.json`, not hardcoded; the dist check enumerates
packages declaring `build:js` and **fails with `run pnpm build`** rather than passing silently.

### Red/green evidence (agent-run)

**Mode (a) — below-baseline spec-surface improvement.** Documented `AbstractNodeDefinition` in
`packages/dag-node/docs/SPEC.md` (count 1 → 0, below its frozen baseline of 1), baseline NOT regenerated:

- RED: `node scripts/harness/run-all-scans.mjs` → **exit 0, "all 61 scans passed"**.
  `pnpm harness:verify-like-ci -- --only harness-self-test` → **exit 1**,
  `check-spec-public-surface.test.mjs > passes on the live repository … and needs no tightening`
  `AssertionError: expected [ Array(1) ] to deeply equal []` —
  `"@robota-sdk/dag-node is below its frozen undocumented-export baseline — tighten the ratchet"`.
- GREEN: after the correct fix (`node scripts/harness/check-spec-public-surface.mjs --write-baseline`)
  → `703 passed`, `✓ harness-self-test / PASS`. Fixture reverted (dag-node is out of this PR's scope).

**Mode (b) — prettier formatter drift on a spec-doc `tags:` array.** Lengthened
`.agents/spec-docs/done/HARNESS-003-simple-harness-scans.md`'s `tags:` flow array past `printWidth: 100`:

- RED: `run-all-scans` → **exit 0, "all 61 scans passed"** (the unformatted single-line form parses
  fine). `pnpm harness:verify-like-ci -- --only format-check` → **exit 1**,
  `[warn] .agents/spec-docs/done/HARNESS-003-simple-harness-scans.md … Run Prettier with --write to fix.`
  (it also caught this PR's own unformatted test file — dogfooded).
- GREEN: after `pnpm exec prettier --write …` → `All matched files use Prettier code style!`,
  `✓ format-check / PASS`.
- **Honest note on the literal #1369 state.** Once prettier rewrites the array to its wrapped
  block form (`tags:\n  [\n    harness,\n    …\n  ]`), `check-spec-doc-frontmatter` reports
  `tags missing or empty` → **exit 1**. So the multi-line state is NOT a local false-pass today;
  `run-all-scans` catches it. The reproducible blind spot is the state a fresh worktree actually
  pushes — the **un**formatted file, green in `run-all-scans` and red in `verify-like-ci`. The
  parser half of the chain is HARNESS-044 (sibling-owned), and `verify-like-ci` surfaces the whole
  chain locally instead of in CI.

**Unbuilt-`dist` stage.** Temporarily removing `packages/dag-node/dist` →
`✗ scan-suite — dist missing for 1 package(s) — run \`pnpm build\``with the actionable block message
(instead of`build-contracts` no-op'ing into a green).

### Wired in

- `.agents/skills/worktree-parallel-orchestration/SKILL.md` § 4 — the implementer's foreground
  self-verification is now `pnpm harness:verify-like-ci` on a built tree, not bare `run-all-scans`.
- `.agents/rules/git-branch.md` — one-line pre-push/pre-merge pointer (no rule text duplicated).

## Related

- **HARNESS-044** — frontmatter scan must parse prettier-wrapped multi-line arrays; a member of this
  class (the formatter-drift-not-caught-locally instance).
- **HARNESS-041** — mechanical accidental-green floor; sibling "the local check must actually assert
  what it claims" floor.
