---
title: 'ARCH-REV-007: Add missing evidence to layering-audit.md (CLI-AUDIT-012 through CLI-AUDIT-023)'
status: todo
created: 2026-05-18
priority: high
urgency: now
area: .agents/specs/architecture-map/agent-cli/layering-audit.md
depends_on: []
---

## Problem

The `layering-audit.md` evidence policy states: "may not be marked resolved without a verification artifact — commit hash, PR number, or grep-output." CLI-AUDIT-012 through CLI-AUDIT-023 (12 of 23 items) are marked resolved with only `branch refactor/arch-002-slim-agent-cli (2026-05-17)`. That branch has since merged and no longer uniquely identifies a verifiable artifact in git log.

The fixes are real and verified against the code — the documentation just needs the actual merge commit or PR number.

Source: Senior Developer (mn-02).

## Recommendation

**Proceed without user approval** — this is a documentation gap (missing evidence references), not a design question. The fixes themselves are verified correct.

1. Run `git log --oneline --merges | grep -i "arch-002\|arch002\|slim-agent-cli"` to find the merge commit/PR
2. Add the PR number or merge commit hash to each of CLI-AUDIT-012 through CLI-AUDIT-023

## Test Plan

- Verify merge PR number from git log: `git log --oneline --all | grep "arch-002-slim-agent-cli"`
- After update, each audit item 012–023 must have either a PR number (e.g. `PR #421`) or a commit hash
- `grep -c "branch refactor/arch-002" .agents/specs/architecture-map/agent-cli/layering-audit.md` must return 0 after the fix

## User Execution Test Scenarios

Not applicable — documentation-only change with no runnable user-facing behavior.
