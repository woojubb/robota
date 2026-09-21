---
title: 'ARCH-1985: select the shared MCP ownership and migration contract before MCP-001'
issue: https://github.com/woojubb/robota/issues/1985
status: in-progress
created: 2026-09-21
priority: critical
urgency: now
area: shared MCP ownership, client migration, and product composition
depends_on: []
---

# ARCH-1985: select the shared MCP ownership and migration contract before MCP-001

## Objective

Establish the product architecture prerequisite that the existing AGREEMENT-014 child graph needs before
MCP-001 through MCP-005 diverge. Record one lower MCP client owner, one dependency-safe migration path,
and the MCP-002/MCP-2522 transport boundary without replacing the already-valid Agreement relationship or
the five source-bound child Task identities.

The foundational finding and independently endorsed re-plan are registered at
[issue #1985 comment 5754525322](https://github.com/woojubb/robota/issues/1985#issuecomment-5754525322).

## Plan

- [ ] TC-01 — Record and accept ADR-005 under the direct owner approval for the private
      `agent-tool-mcp` → `agent-mcp` reclassification and exported `agent-core` contract removal.
- [ ] TC-02 — Add `ARCH-1985` as MCP-001's direct prerequisite and verify MCP-002 through MCP-005 remain
      transitively ordered through their existing dependencies.
- [ ] TC-03 — Preserve AGREEMENT-014 byte-for-byte as the existing five-child relationship owner and
      update issue #1985/#2525 execution maps to name this architecture prerequisite.
- [ ] TC-04 — Bind the DAG sibling-consumer migration, fail-closed MCP-002 stdio checkpoint, MCP-2522-only
      restoration, and independent server direction to ADR-005 and the paired spec.
- [ ] TC-05 — Validate the Task/spec/ADR lifecycle, exact dependency graph, formatting, and affected
      repository scans before MCP-001 starts.

## Constraints

- ARCH-1985 is not a parent Task and declares no `children`; AGREEMENT-014 remains the sole relationship
  owner for MCP-001 through MCP-005.
- MCP-001 may remove the exported `agent-core.IMCPToolConfig` and `IToolFactory.createMCPTool()` only under
  the direct approval recorded in this conversation, with SPEC/changelog treatment and no compatibility
  facade.
- `agent-mcp` is the sole outbound MCP definition/client owner; framework and command remain generic,
  CLI and DAG remain sibling consumers, and `agent-transport-mcp` remains the opposite server direction.
- MCP-002 owns the shared SDK Client and Streamable HTTP migration. Stdio fails closed without spawning
  until MCP-2522 alone restores the admitted shared subprocess path.

## Test Plan

- Run ADR completeness and Task/spec lifecycle scans.
- Assert MCP-001 directly depends on ARCH-1985 and every later client-stream Task remains transitively
  ordered without a replacement parent or duplicate child Task.
- Assert the AGREEMENT-014 Task/spec pair has no diff against `origin/develop`.
- Read issue #1985/#2525 back after map updates and retain exact URLs as evidence.
- Run formatting, `git diff --check`, and affected repository scans over the completed architecture unit.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** ARCH-1985 records a package-ownership, dependency, and migration decision only. It changes no
CLI, TUI, browser, or public SDK behavior itself; MCP-001, MCP-002, and MCP-2522 own the runnable product
scenarios for configuration, HTTP use, and restored safe stdio execution.

## Recommendation Evidence

- MCP-001 finding-depth triage: `DEPTH: FOUNDATIONAL` on 2026-09-21.
- Product proposal review converged after correcting duplicate ownership, DAG client ownership, and the
  MCP-002/MCP-2522 boundary; final result: `REVIEW VERDICT: ENDORSE`.
- Planning-shape re-review verified that a new Agreement cannot adopt existing MCP-001 through MCP-005,
  rejected replacement child identities and a harness-policy expansion, and endorsed this non-parent
  architecture prerequisite: `REVIEW VERDICT: ENDORSE`.
- Direct owner instruction: `모두 승인하고, 앞으로의 것도 모두 타당한 근거와 함께 제시된 추천안이라면 그게ㅏ 타당할 경우 사전 승입합니다.`
