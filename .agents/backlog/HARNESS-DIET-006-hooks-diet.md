---
title: 'HARNESS-DIET-006: hooks — remove duplicate, slim heavy, merge duplicated, narrow over-broad'
status: todo
created: 2026-07-23
priority: medium
urgency: soon
area: .claude/hooks, .claude/settings.json
depends_on: []
---

# HARNESS-DIET-006: hook diet

## Progress (2026-07-23)

- **DONE:** removed `check-no-reexport.sh` (non-neutral `@robota-sdk`, non-blocking warning; its `export *`
  pass-through case is already CI-gated by `check-dependency-direction.mjs` `checkPassthroughReexports`) +
  unwired it from `settings.json`. Slimmed `post-tool-format.sh` — dropped the per-edit `npx eslint --fix`
  (lint-staged batches it at commit; removes a node cold-start from every Write/Edit); prettier-only remains.
- **REMAINING:** slim `pre-push-check.sh` (drop the full typecheck/lint/test re-run), narrow `spec-first-gate.sh`
  (over-broad matcher), merge `task-tracking-start.sh`+`task-tracking-stop.sh` (duplicated `classify_task`),
  slim `check-forbidden-patterns.sh`, tighten `correction-detect.sh` — each behavioral, its own careful PR.

## Problem

Of 12 hooks, none is wired-but-dead, but several duplicate CI scans / git-native husky hooks / ESLint, fire on
nearly every turn with advisory-only output, or hardcode `@robota-sdk`/`.agents/tasks` paths. Mechanical hooks
are the right enforcement layer (memory `harness-mechanical-not-skilltree`) — so the genuinely blocking, neutral
ones stay; the redundant/advisory/over-broad ones get cut. Keep intact: `branch-guard`, `memory-mirror-reminder`,
`eval-log-stop` + `revert-detect`.

## What

- **REMOVE `check-no-reexport.sh`** — hardcodes `@robota-sdk/`, exits 1 as a non-blocking PostToolUse warning
  (not fed back as a block), and its `export *` pass-through case is already CI-gated by
  `check-dependency-direction.mjs` (`checkPassthroughReexports`). If the named-`export {…} from` cross-package
  case must be guarded, add it to that neutral, blocking scan instead.
- **SLIM `pre-push-check.sh`** — it runs the full-repo `pnpm typecheck` + `lint` + **entire test suite** on every
  push, duplicating `.husky/pre-push` (`harness:pre-push`) and CI. Keep only the cheap lockfile-sync +
  foreign-merge branch-hygiene gates; drop the heavy re-runs.
- **SLIM `post-tool-format.sh`** — drop the per-edit `npx eslint --fix` (node cold-start after _every_ Write/Edit);
  `lint-staged` (`.husky/pre-commit`) already batches the identical `eslint --fix` + `prettier --write`. Keep
  prettier-only for fast feedback, or remove entirely.
- **SLIM / NEUTRALIZE `spec-first-gate.sh`** — its trigger list (`\bcode\b`, `\badd\b`, `\bchange\b`, `\bwrite\b`,
  `\bfix\b`) fires on nearly every dev prompt, and the output is an advisory reminder (real enforcement is
  `scan-spec-research` + GATE-WRITE). Narrow the trigger to strong "implement a new feature" intent, or retire the
  reminder. Also de-hardcode the `.agents/spec-docs/draft`/`backlog-writer` paths.
- **MERGE `task-tracking-start.sh` + `task-tracking-stop.sh`** — `classify_task()` is byte-for-byte duplicated in
  both. Fold into one script invoked in `SessionStart`/`Stop` modes so the logic has a single owner.
- **SLIM `check-forbidden-patterns.sh`** — `any` and `console.*` are already ESLint `error`s and the regex is
  false-positive-prone (trips on an inline `// … any …` comment); the fallback case is covered by
  `scan-no-fallback`. Keep at most the pre-write fallback block, or remove.
- **TIGHTEN `correction-detect.sh`** — keep the `corrections.jsonl` metric; require an explicit "make this a rule"
  phrasing for the `lesson-to-harness` nudge instead of firing on common words (`always`/`never`/`항상`/`반드시`).

## Test Plan

- After each change, the hook still fires on its intended case and no longer on the removed case (add a small
  fixture/echo test where practical); `.claude/settings.json` wiring stays valid.
- Confirm the removed/duplicated coverage is retained by its owner (CI scan / husky / ESLint) — cite the owner in
  the PR.

## User Execution Test Scenarios

- Not applicable (hook/infra change; the retained CI scans + husky hooks are the maintained gate).
