# MCP-002 delivery state, 2026-09-22

**The sentence, because it is the whole entry:**

> MCP-002 landed on `integration/agreement-014` through PR #2818 (owner-merged 2026-09-22, merge
> `a63fe09f8`) after a three-round local review (8 → 3 → 0); MCP-003 is superseded by it, and the
> later AGREEMENT-014 units start from MCP-004.

## Where it stands

- Delivery commit `feat(mcp): build the shared MCP client and the HTTP product vertical slice
(MCP-002)`: 27/27 criteria recorded PASS, GATE-VERIFY PASS (after one FAIL on a deferral clause —
  [[a-ticked-box-cannot-carry-its-own-deferral]]), GATE-COMPLETE PASS; the pair sits in
  `.agents/spec-docs/done/` and `.agents/tasks/completed/` via the manual route (`task-complete.mjs`
  refuses initiative children), and AGREEMENT-014's rows read `MCP-002 — done`.
- Product reachability is real: `robota -p "/mcp list"` under an isolated HOME lists the servers
  declared under `mcpServers` in the layered settings files. Approval is in-memory in this unit — a
  server approved mid-session connects on the next start.
- Known, non-blocking: the repo-wide lint warning budget may be exceeded when CI runs the full sweep
  (the lockfile change triggers it); the new files' warnings are `unknown`-at-boundary only.

## What comes next

MCP-004 (background handoff for long MCP calls) is next on `feat/mcp-004-background-mcp-calls`; then MCP-005/2525, 006/007, 008/2533, MCP-2522 (stdio),
MCP-2817 (remove the DAG↔MCP surfaces). The final `integration/agreement-014 → develop` PR stays open
for the owner. Session memory: `robota-mcp-002-session-state`.

## MCP-004 (2026-09-22, same day)

MCP-004 (long MCP calls → `tool-invocation` background tasks, issue #2524) was implemented on
`feat/mcp-004-background-mcp-calls` in three seams by sonnet workers (S1 contracts/codec/runner/admission,
S2 `IMCPTimeouts.toolCallMs`, S3 framework wrapper + CLI settings/mode plumbing + TUI forwarding) under
the owner's "skip the ceremony, finish and close the issue" instruction: gate records after GATE-IMPLEMENT
and the Round A review loop were deliberately skipped; every package suite, the build and
`pnpm scenario:verify:mcp-background` were green before the commit. Next units: MCP-005/2525, 006/007,
008/2533, MCP-2522 (stdio), MCP-2817; the final `integration/agreement-014 → develop` PR stays the owner's.

## MCP-005 (2026-09-22, in flight)

MCP-005 (provider-safe MCP tool-schema projection, issue #2528) on `feat/mcp-005-schema-projection`:
spec passed GATE-WRITE → GATE-APPROVAL (owner "승인 — 구현 진행", then "승인 갱신 — 구현 진행" after the
proposal-reviewer's REVISE was folded in and re-reviewed to ENDORSE) → GATE-IMPLEMENT; DONE-GATE-STAGE-1 on the
Task; checkpoint `a930dd1fb`. Lessons: (1) every checkpoint commit needs a Task scenario in the contract form
(`validateApplicableScenarioSection` from `scripts/harness/user-execution-scenario-contract.mjs` checks it
locally) AND a DONE-GATE-STAGE-1 PASS payload, and the spec needs a mirrored `## User Execution Test
Scenarios` section; (2) a root item's ID must not reuse an existing child ID under the same umbrella
(`MCP-2525` already existed → `CATALOG-2525`); (3) GATE-APPROVAL's conditional independent-validation
criterion applies to "a new module that could live in more than one place" and needs a recorded ENDORSE on
the CURRENT text — a REVISE folded in silently is a FAIL. Root items filed: PROV-2138 (abstract provider
pipeline is a convention), CATALOG-2525 (catalog root coercion / unwalked anyOf), CLOSURE-2138 (strict null
compensation vs execution refusal).
