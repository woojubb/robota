---
title: 'LESSON-010: lessons metrics detector quality — 4 of 5 auto-lesson signals are noise'
status: todo
created: 2026-07-04
priority: medium
urgency: soon
area: scripts/harness, .claude/hooks, .agents/evals
depends_on: []
---

# Lessons metrics detector quality

Lesson review (2026-07-04, user: "교훈을 확인해") measured the raw signal quality behind
`auto-lessons.md` and found 4 of the 5 candidate patterns are detector noise, not lessons.
An unreliable lessons pipeline defeats its purpose: recurring signals cannot be reviewed when
they are drowned by counter bugs.

## Findings (measured against `.agents/evals/local-metrics/*.jsonl`)

1. **`same-file-edited-3-times` runaway counter** — `reverts.jsonl` holds 297,639 lines;
   296,376 are this pattern. Once a file crosses 3 edits, EVERY subsequent edit re-emits an
   event, cumulatively and forever (`packages/agent-cli/src/cli.ts` alone: 1,081 events;
   reported "73,047 events in the last 7 days"). Also mis-sourced as `reverts`.
2. **Backlog files are false positives by design** — the done-gate workflow REQUIRES editing a
   backlog file 3+ times (create → evidence → status/move). Example paths in the digest are
   dominated by `.agents/backlog/*`, which can never be a defect signal.
3. **`repeated-tool-errors` captures no context** — 181 events, `Example paths: (none)` always;
   the signal is unactionable without the failing tool/file.
4. **Stale sections presented as fresh** — `fix-or-revert-commit` and `console-usage` show May
   data under a "Frequency: N events in the last 7 days" label; the digest upserts
   threshold-crossing patterns but never refreshes/prunes sections that fell below threshold.
5. **Agent utterances counted as user corrections** — `corrections.jsonl` contains
   agent-generated eval prompts (session_id `agent_1`, "…하지 마세요") and empty-session_id
   rows tallied into `user-correction` (23/7d), inflating the one genuinely useful signal.
6. **Unbounded growth** — `reverts.jsonl` grows without rotation/compaction; at ~300k lines the
   digest run cost and repo-local disk churn keep climbing.

## What

1. Emit `same-file-edited-3-times` at most once per (file, session) window — a threshold
   crossing, not a per-edit repeat; correct its source label.
2. Exclude workflow-required multi-edit paths (`.agents/backlog/**`, `.agents/tasks/**`,
   lessons churn files) from the same-file detector.
3. Capture context for `repeated-tool-errors` (tool name, file path, error class) so examples
   are never `(none)`.
4. Digest refresh semantics: sections below threshold in the current window are re-dated or
   dropped — never left claiming "last 7 days" with stale data.
5. Filter corrections to real user turns: require a session_id belonging to a user session and
   skip agent/subagent-authored prompts.
6. Rotation/compaction policy for `local-metrics/*.jsonl` (size or age bound, local-only per
   the audit-output policy).
7. Unit tests in the harness suite per detector fix (fixture jsonl in, expected candidates out).

## Test Plan

- Harness suite: fixture-driven tests per detector (runaway repeat, backlog-path exclusion,
  agent-utterance exclusion, stale-section refresh, rotation trigger).
- `pnpm harness:lessons:digest` on the real local metrics: candidate list shrinks to signals a
  human can review; no "(none)" example rows for patterns that have file context.

## User Execution Test Scenarios

Not applicable — harness/metrics tooling only; no runnable user-facing product behavior.
Verification evidence lands in the Test Plan (fixture tests + a before/after digest diff).
