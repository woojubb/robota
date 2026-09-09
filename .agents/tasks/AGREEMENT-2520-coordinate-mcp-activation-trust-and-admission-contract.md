---
title: 'AGREEMENT-2520: coordinate MCP activation trust and admission contract'
issue: https://github.com/woojubb/robota/issues/2520
status: todo
created: 2026-09-09
priority: critical
urgency: now
area: MCP activation trust and admission contract
depends_on: [MCP-001]
children: [MCP-2520]
---

# AGREEMENT-2520: coordinate MCP activation trust and admission contract

## Objective

Coordinate the shared product contract between typed MCP definitions, client activation, workspace
trust, and the retained security lifecycle in [issue #2520](https://github.com/woojubb/robota/issues/2520).
The existing `AGREEMENT-014` only coordinates administrative Issue-to-Task migration and explicitly
does not own product code. This agreement therefore fixes the cross-package relationship before
`MCP-002` and `MCP-2520` implement independently: definitions preserve provenance, every client and
transport reaches one activation-admission port, and project/plugin content cannot grant its own trust.

This is a planning and contract-coordination work unit, not a runtime implementation. The retained
external Issue remains open until its security outcome is delivered.

## Children

- [ ] MCP-2520 — todo — `.agents/tasks/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md`

## Source Constraints

- `MCP-001` owns typed MCP configuration, scope/precedence, and definition provenance.
- `MCP-002` owns the shared client and transport composition, but may not connect or spawn without the
  admission contract fixed here.
- `MCP-2520` owns approval, rejection, revocation, audit/status, workspace/plugin trust, and the
  fail-closed activation policy.
- No child may duplicate another child's source-of-truth types or bypass the lower admission port.
- OAuth, headersHelper, stdio sandbox restrictions, and schema projection remain separate contracts.

## Plan

- [ ] Inventory the exact current contracts, dependency edges, and activation paths in the three
      child areas and record the owner boundary.
- [ ] Define the provider-neutral contract matrix: definition identity, provenance, fingerprint,
      approval state, audit evidence, admission decision, and transport handoff.
- [ ] Freeze the fail-closed invariants and dependency order in the paired spec, including the
      inspection-without-activation rule and the direct-client bypass negative case.
- [ ] Update child Task dependencies/spec references so `MCP-002` and `MCP-2520` implement the same
      agreement without changing product behavior in this administrative checkpoint.
- [ ] Run document, relationship, task-order, and affected harness scans before implementation begins.

## Completion Criteria

- [ ] TC-01: Observable: the paired spec names exactly one owner for each shared MCP activation
      contract field and both child Tasks cite that spec.
- [ ] TC-02: Observable: the paired spec records the fail-closed rules for untrusted workspaces,
      checked-in self-approval, definition/provenance/identity changes, revocation, and status-only
      inspection.
- [ ] TC-03: Observable: the Task dependency graph has `MCP-001` before this agreement and this
      agreement before both `MCP-002` and `MCP-2520`, with no circular dependency.
- [ ] TC-04: Command: the affected harness document and task-order scans exit zero and no TypeScript,
      runtime, package, or GitHub mutation is present in the agreement checkpoint.

## Test Plan

Read back the paired spec, all named child Task frontmatter, and the current MCP package/framework
owners. Assert the exact field-owner matrix, fail-closed invariants, and acyclic dependency order.
Run the document-authoring, task-plan, task-path, and planning-order scans against the changed records;
the checkpoint must contain documentation only.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This agreement changes only internal planning ownership and dependency metadata; it adds no
directly runnable user or operator surface. The child implementation Tasks own the security flow
scenarios and their product-level execution evidence.
