---
title: 'SEC-002: triage ~170 open CodeQL alerts (109 high-severity) accumulated behind an advisory gate'
status: todo
created: 2026-07-25
priority: high
urgency: soon
area: packages, scripts
depends_on: []
---

# SEC-002: CodeQL alert backlog triage

## Problem

CodeQL runs on every push/PR but is **advisory** (not a required check), so its findings were never
triaged and have accumulated. Current open alerts on `develop` (measured 2026-07-25 via
`gh api repos/woojubb/robota/code-scanning/alerts --paginate`):

| Rule                                       | Open | Severity   |
| ------------------------------------------ | ---- | ---------- |
| `js/insecure-temporary-file`               | ~109 | **high**   |
| `js/polynomial-redos`                      | 18   | high       |
| `js/comparison-between-incompatible-types` | 5    | —          |
| `js/regex/duplicate-in-character-class`    | 4    | —          |
| `js/unused-local-variable` etc.            | ~130 | style/none |

`js/insecure-temporary-file` concentrates in `packages/agent-framework` (~76), `packages/dag-cli`
(~18) and `packages/agent-cli` (~12). `js/polynomial-redos` hits real parsing code:
`agent-command/src/schedule/schedule-spec-parser.ts`, `agent-core/src/schema/structured-output.ts`,
`agent-cli/src/subagents/git-worktree-isolation-adapter.ts`, `dag-cli/src/commands/convert.ts`,
`agent-playground/.../agent-config-parser.ts`.

A high-severity alert class this large sitting unreviewed is itself the defect — nobody has decided
whether each is real, and the volume now hides any NEW alert in the noise.

## What

1. **Triage by class, not by alert.** For `js/insecure-temporary-file`, determine the shared pattern
   (predictable path in the OS temp dir?) and decide once: fix at the source (a single safe
   temp-path helper — `mkdtemp`-based — that all sites adopt) or dismiss-with-reason where the write
   is provably not attacker-influenced. Do NOT click through ~109 alerts individually.
2. **`js/polynomial-redos`** — assess each regex for real super-linear backtracking on
   attacker-reachable input; fix the reachable ones (bounded quantifiers / anchored alternatives) and
   dismiss the unreachable with a recorded reason.
3. **Style-class alerts** (`js/unused-local-variable`, …): decide policy — either fix in a sweep or
   tune the CodeQL query set so they stop competing with security findings for attention.
4. **Close the loop mechanically**: once the backlog is at zero-or-explained, decide whether CodeQL
   (or at least its `security-severity: high` subset) becomes a REQUIRED check so this cannot silently
   re-accumulate. Coordinate with INFRA-046 (advisory→required promotion criteria).

## Test Plan

Per fixed class: a red-first regression test where feasible (e.g. the temp-path helper's test proves
the generated path is unpredictable and the old pattern is gone via a grep floor). After the sweep,
`gh api …/code-scanning/alerts` shows zero open high-severity alerts, or each remaining one carries a
dismissal reason. `run-all-scans` + full suites green.
