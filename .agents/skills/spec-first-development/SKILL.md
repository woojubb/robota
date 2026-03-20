---
name: spec-first-development
description: Use before implementing any change that touches a contract boundary (package imports, class dependencies, service connections, cross-package types). Ensures the governing spec is updated before code is written and a verification test plan exists.
---

## Rule Anchor

- "Spec-First Development" in `.agents/rules/process.md`

## When to Use

Trigger this skill when a change affects any of these:
- Package public API surface (exports, types, interfaces)
- HTTP/WebSocket API endpoints (request/response shapes)
- Class-to-class dependencies across module boundaries
- Cross-package type definitions or contracts

## Workflow

### Step 1: Identify contract boundaries

List all package/service/class connections affected by the change.
For each boundary, answer:
- What is the current spec? (SPEC.md, OpenAPI, contract definition, or none)
- What part of the spec changes?

### Step 2: Check existing specs

For each identified boundary:
- Package surface → check `packages/<name>/docs/SPEC.md`
- HTTP API → check OpenAPI or API spec document
- Class contract → check contract definition in owning package

If no spec exists, one must be created before proceeding.

### Step 3: Update or create spec

- **Package SPEC.md** → use [`spec-writing-standard`](../spec-writing-standard/SKILL.md)
- **API specification** → use [`api-spec-management`](../api-spec-management/SKILL.md)
- **Class contract** → document in the owning package's `docs/SPEC.md` or dedicated contract file

The spec change must be reviewed and approved before implementation begins.

### Step 4: Define verification test plan

For each spec change, define:
- **What to test:** which contract assertions validate the change
- **How to test:** unit / integration / contract test
- **Commands to run:** exact verification commands

Use [`contract-audit`](../contract-audit/SKILL.md) for contract consistency checks.

### Step 5: Implement to spec

- Write code that conforms to the updated spec
- Follow TDD cycle (see [`tdd-red-green-refactor`](../tdd-red-green-refactor/SKILL.md))
- Build and verify (see [`repo-change-loop`](../repo-change-loop/SKILL.md))

### Step 6: Verify conformance

- After implementation, run the full conformance verification loop
- See [`spec-code-conformance`](../spec-code-conformance/SKILL.md)
- This step is mandatory — implementation is not complete until conformance is verified with zero gaps and regression tests pass

## Orchestrated Skills

| Skill | Role in this workflow |
|-------|----------------------|
| `spec-writing-standard` | SPEC.md structure and quality gates |
| `api-spec-management` | API spec format and update workflow |
| `contract-audit` | Contract consistency verification |
| `tdd-red-green-refactor` | Implementation cycle |
| `repo-change-loop` | Build and verify loop |
| `spec-code-conformance` | Post-implementation conformance verification loop |
