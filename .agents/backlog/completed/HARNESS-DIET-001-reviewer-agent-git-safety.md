---
title: 'HARNESS-DIET-001: read-only reviewer/auditor agents must not run tree-mutating git'
status: done
completed: 2026-07-23
created: 2026-07-23
priority: high
urgency: now
area: .claude/agents, scripts/harness/check-agent-def-convention.mjs
depends_on: []
---

# HARNESS-DIET-001: reviewer-agent destructive-git safety

## Outcome (DONE 2026-07-23)

Added a `## Working-tree safety (read-only)` guardrail (the phrase "tree-mutating git" + the concrete ban on reset/checkout/clean/stash/rm/commit/push/apply) to all 8 read-only agents (architecture-auditor, architecture-conformance-auditor, capability-scout, doc-auditor, merge-verifier, pr-review-reviewer, prior-art-researcher, proposal-reviewer). Rewrote pr-review-reviewer's red-proof to an ISOLATED `git worktree add` only (deleted the live-tree checkout/revert wording). Mechanized via `check-agent-def-convention.mjs`: a read-only agent carrying `Bash` whose body lacks the guardrail now FAILS the scan (proven red-before-green; +2 unit tests, 12 pass).

## Problem

All 8 read-only reviewer/auditor/worker agents carry `Bash` in their `tools:` and **none forbids tree-mutating
git**: `architecture-auditor`, `architecture-conformance-auditor`, `capability-scout`, `doc-auditor`,
`merge-verifier`, `pr-review-reviewer`, `prior-art-researcher`, `proposal-reviewer`. Claude Code's `tools:`
cannot sub-scope `Bash` to read-only git, so each can run `git reset --hard` / `checkout` / `clean` / `stash` and
destroy uncommitted work. **This actually happened this session**: a `proposal-reviewer` ran `git reset --hard`
mid-review and deleted an untracked spec-doc; separately a `pr-review-reviewer` was warned off the same.

Two are worse than the rest:

- **`pr-review-reviewer`** actively _instructs_ tree mutation in its body ("temp checkout of `origin/<base>`",
  "revert only the source fix and run") — standing procedure that is destructive on a dirty tree.
- **`merge-verifier`** forbids `merge/push/delete` but not `reset/checkout/clean` — a hole, and it routinely runs
  git.

## What

1. Add a standard guardrail line to each of the 8 read-only agents' system prompts, e.g.:
   > You are READ-ONLY. Never run tree-mutating git in the working tree — no `reset`, `checkout`, `clean`,
   > `stash`, `rm`, `commit`, `push`, `apply`. To inspect other states use `git show`/`git diff`/`git log`
   > against refs, or an isolated `git worktree add <tmp>` you remove afterward.
2. Rewrite `pr-review-reviewer`'s regression red-proof procedure to use an isolated `git worktree add <tmp>`
   ONLY; delete the "temp checkout of origin/<base>" / "revert only the source fix in the working tree" phrasings.
3. Extend `merge-verifier`'s "what is NOT your job" list to explicitly ban `reset/checkout/clean/stash`.
4. **Mechanize** it: extend `scripts/harness/check-agent-def-convention.mjs` to FAIL any agent whose `tools:` is
   read-only (no `Edit`/`Write`) and whose body lacks the tree-mutating-git ban. This is the guardian floor so
   the guardrail cannot rot out.

## Test Plan

- `check-agent-def-convention` red-before-green: it must FAIL on the current agents (no ban present), then pass
  after the ban lines are added. Register the updated scan in `run-all-scans` (already registered).
- Spot-check: each of the 8 agents contains the ban; `pr-review-reviewer` no longer mentions a working-tree
  checkout/revert.

## User Execution Test Scenarios

- Not applicable (harness/agent-definition change; the `check-agent-def-convention` scan is the maintained gate).
