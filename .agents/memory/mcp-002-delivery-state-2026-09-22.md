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
