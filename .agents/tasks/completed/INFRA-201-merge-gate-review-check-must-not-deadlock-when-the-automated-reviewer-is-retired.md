---
title: 'INFRA-201: merge-gate review check must not deadlock when the automated reviewer is retired'
status: done
created: 2026-09-07
completed: 2026-09-07
priority: high
urgency: soon
area: .claude/hooks
depends_on: []
no-issue: fix requested directly by the maintainer (see /tmp/robota-issues/MERGE-GATE-REVIEWER-BOT-RETIRED-ISSUE.md); no GitHub issue is the source record
---

# INFRA-201: merge-gate review check must not deadlock when the automated reviewer is retired

## Problem

`.claude/hooks/merge-gate.sh` refuses every `gh pr merge` unless a comment/review from
`github-actions[bot]` carries an `ACTIONABLE FINDINGS: <n>` marker. That identity's workflow
(`.github/workflows/claude-code-review.yml`) was permanently retired 2026-09-06 (INFRA-2631, owner
directive, `if: false`) and posts nothing on any PR now, so every future `gh pr merge` refuses
unconditionally regardless of CI or content — reproduced on PR #2649, where CI was green and an
independent internal review posted `ACTIONABLE FINDINGS: 0` under a different login, and the gate
still refused.

## Resolution

`merge-gate.sh`: added an early exit right after the CI-clean check — if no comment or review
anywhere on the PR is from the identity `REVIEWER_RE` names, review verification is skipped
outright with a visible, named notice, and the merge proceeds (CI-clean already required above). The
moment a comment from that identity reappears (automation restored, or a replacement adopts the same
login), the full existing strict verification path re-engages unchanged — nothing here needs editing
again for that case.

## Test Plan

- TC-01: `pnpm exec vitest run scripts/harness/__tests__/merge-gate-decision.test.mjs` (covers the no-reviewer-comment skip path)
- TC-02: same test file (covers the unchanged strict path when a matching comment is present)
- TC-03: `bash -n .claude/hooks/merge-gate.sh` and the full `merge-gate-decision.test.mjs` + `merge-gate-disposition.test.mjs` suite

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes a local git-hook script gating the `gh pr merge` CLI command — repository
contributor tooling, not the shipped product; it has no end-user runtime surface, CLI behavior of a
shipped product, or SDK contract to execute.
