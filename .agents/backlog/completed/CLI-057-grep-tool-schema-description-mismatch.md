---
title: 'CLI-057: Grep tool description advertises count mode and head_limit that do not exist'
status: done
created: 2026-06-10
completed: 2026-06-11
priority: high
urgency: soon
area: packages/agent-tools
depends_on: []
---

# CLI-057: Grep tool description/schema mismatch (`count`, `head_limit`)

## Problem

The Grep builtin's LLM-facing description (`packages/agent-tools/src/builtins/grep-tool.ts:229`)
promises: "'count' shows match counts" and "Use head_limit to control result size", but the
actual schema only defines `outputMode: 'files_with_matches' | 'content'` and has no
`head_limit` parameter (grep-tool.ts:18-42). The LLM will periodically emit `output_mode:
"count"` or `head_limit: 50` calls that fail schema validation or are silently dropped,
wasting turns and degrading agent quality.

## Expected Behavior

Spec-first decision, then make description and schema agree:

- Preferred: implement `count` output mode and `head_limit` parameter (both are cheap on top
  of the existing match pipeline), or
- Reduce the description to the actually supported modes/parameters.

## Test Plan

- Unit tests: `count` mode returns per-file match counts; `head_limit` caps results in both
  output modes (if implemented).
- Schema/description consistency assertion test (description mentions only schema-supported
  parameters).
- `pnpm --filter @robota-sdk/agent-tools build && pnpm --filter @robota-sdk/agent-tools test`

## User Execution Test Scenarios

- Prerequisite: built CLI binary; provider key configured. Environment already exists.
- Steps: in a repo, run `robota -p "count how many files contain the word 'import' using the
Grep tool with count mode"`.
- Expected observable result: the Grep tool call succeeds (no schema validation error in the
  transcript) and returns counts (if implemented) or the agent uses a supported mode without
  emitting invalid parameters (if description was reduced).
- Cleanup: none.
- Evidence (2026-06-11): implemented (preferred option). `grep-tool.test.ts` 9/9 pass — count mode
  returns `path:count` rows; `headLimit: 2` caps to 2 rows + `(+1 more results truncated by
headLimit)` marker; schema rejects `headLimit: 0`; description now lists exactly the three real
  modes and `headLimit` (camelCase, matching sibling fields). Live-LLM transcript portion of the
  scenario requires a provider key (none configured in this environment); schema-validation
  acceptance of `outputMode: 'count'` is unit-proven so the invalid-call failure mode is gone.
