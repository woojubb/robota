---
title: "RULE-016: PR bodies open with gate vocabulary and carry the agent's session link; the PR-description contract states fields but no order and no prohibition"
issue: https://github.com/woojubb/robota/issues/2403
status: done
completed: 2026-08-28
created: 2026-08-28
priority: high
urgency: now
area: .agents/rules, .github, scripts/harness, commitlint.config.js, .agents/memory
depends_on: []
---

# RULE-016: a PR body opens with what was broken and for whom, and carries no agent-session link

## Problem

PR #2402 opened with the pipeline's own vocabulary — "Accepted recommendation: A2 …", `REVIEW
VERDICT`, TC-0n — before saying what was broken, for whom, and what changes; and it carried the Claude
Code session URL and a "🤖 Generated with Claude Code" footer. Every commit on that branch (and on
PR #2396's) carries a `Claude-Session: https://claude.ai/code/session_…` trailer. The owner rejected
both on 2026-08-28 and asked that the rule live in the repository.

## Evidence

- `.agents/rules/backlog-execution.md` § PR Unit Rule (line ~350) is a fields-only bullet — no order,
  no background; PR #2396's body is that field list in that order. Written 2026-05-09, never reshaped.
- The PR body has three owner documents that do not cite each other: `.github/PULL_REQUEST_TEMPLATE.md`
  (+ byte-identical `pull_request_template.md`) ordering `## Summary → ## Related issue → ## Type of
change → ## How was this tested? → ## Checklist`; § PR Unit Rule's unordered fields;
  `agent-conduct.md:65-67` ("PR descriptions … prose without bullets"). 59 merged PRs before PR #2402:
  8+ opening shapes, none opening with background; 1 of the last 80 carries `## Background`.
- Session links: 91 of the last 200 merged PRs; 1105 of 4813 commits carry `Claude-Session:` (2630 trailer lines).
  `git grep` over `.agents`, `.claude/hooks`, `commitlint.config.js`, `scripts/harness` finds only a
  completed record's note (`PROC-012-….md:100`) — no rule, no refusal.
- Surfaces that already judge these artifacts: `commitlint.config.js` (`reference-kind` plugin rule,
  required `commitlint` check, wiring test); `review-gate.yml` (required check, reads the PR before
  checkout for PROC-007, and its comment names why a hook cannot be the primary floor for a PR-level
  property). `merge-gate.sh` never reads the body.

## Depth verdict and re-plan

`finding-depth-triager` (2026-08-28): **FOUNDATIONAL** — no single owner for the PR body; a heading
regex in the merge gate would refuse the template's own shape. Owner decision the same day:
**re-plan** — this item is the root (one contract, three documents aligned, floors at the required
check and commitlint), and the `Claude-Session:` trailer is prohibited in commits as well.

## Why it is worth fixing rather than working around

A PR is read by people who were not in the session; the first thing they need is what was broken, for
whom, and what changes. A session URL is a private link in a shared, permanent record. A contract with
three owners is what let both persist for two months at half of all output.

## Recommendation gate

`proposal-reviewer`, three rounds on 2026-08-28: REVISE (body floor at the wrong surface — merge-gate
cannot see auto-merge; presence not position; it would refuse the repo's own template; A3's stated
obstacle was a closed item) → RE-PLAN on the FOUNDATIONAL depth verdict (three owner documents) →
REVISE (the step must sit after the base-sha checkout, body via `env:`, no PR comment; two sequenced
PRs forced by the base-revision judge; promotion PRs judged) → REVISE (eight textual consistency
corrections, applied; two readings for the owner: one recommendation gate for a forced sequencing,
and the git-branch.md commit bullet travelling with its floor in PR 1). The revision bound was reached;
the decision (A5) was not contested in any round. Alternative chosen: A5.

## Test Plan

- Rule texts: § PR Unit Rule owns the seven ordered sections (Background first) and the no-link
  prohibition, MUST-phrased, with `Enforced by:`; git-branch.md § Git Operations carries the commit
  half with `Enforced by: no-session-link`; agent-conduct.md's prose clause no longer names PR
  descriptions and its boundary names the owner. `new-rule-declares-enforcement` examines the added
  bullets.
- Template: `.github/PULL_REQUEST_TEMPLATE.md` rewritten to the contract; the duplicate deleted; a
  test feeds the template's first heading to the judge.
- Judge + required check: `scripts/harness/check-pr-body.mjs` (first heading is `## Background`; no
  session URL; no Claude Code footer; empty body is a problem) with refuse/accept cases, and a
  `review-gate.yml` step directly after the base-sha checkout (no `if:`, body via `env:`) invoking
  it, pinned by test. Delivered as two sequenced PRs: the judge, template and commitlint rule first;
  the workflow step, rule texts, memory and inventory second — the step loads the judge from the base
  revision, so the introducing PR's own required check would otherwise fail.
- Commitlint: `no-session-link` beside `reference-kind`; a wiring test proves refuse (trailer, URL)
  and accept (`Co-Authored-By` only).
- Memory: a pointer record in `.agents/memory/` (memory-mirroring.md §3–4).
- Applied-check mutation: disabling each floor must make its test red.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

A user-execution scenario is **not applicable**. This changes a rule document, a commit-message lint
rule, a required-check step and a memory record — repository governance and machinery; no product
surface changes. The verification surface is the three fixture tests and the mutation.

## Bound spec document

`.agents/spec-docs/done/RULE-016-pr-body-opens-with-background-and-carries-no-session-link.md`
