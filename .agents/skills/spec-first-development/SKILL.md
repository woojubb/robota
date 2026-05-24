---
name: spec-first-development
description: Use before implementing any change that adds, removes, or modifies package behavior, public API, types, or contracts. Ensures the governing spec is updated before code is written and a verification test plan exists.
---

## Rule Anchor

- "Live Spec Policy" in `.agents/rules/spec-workflow.md`
- "Spec-First Development" in `.agents/rules/spec-workflow.md`

## When to Use

Trigger this skill for **any** of the following — not only contract-boundary changes:

- Adding a new feature or behavior to a package
- Changing existing behavior, semantics, or configuration
- Adding or removing a public export (class, function, type, constant)
- Adding or changing an error type, code, or recoverability
- Adding or changing a lifecycle event or state transition
- Adding or changing an HTTP/WebSocket endpoint (request/response shapes)
- Adding or changing a class-to-class dependency across module boundaries
- Removing a feature or deprecating an export

If the change only touches internal implementation details with no observable behavioral difference
and no public API change, the spec update is not required — but if in doubt, update the spec.

## Workflow

### Step 1: Identify the affected package and spec

Name the package that owns the changed behavior. Locate its governing spec:

- Package behavior / public surface → `packages/<name>/docs/SPEC.md`
- HTTP API → OpenAPI or API spec document
- Cross-package contract → `.agents/specs/` cross-cutting spec

If no spec exists for the package, create one using
[`spec-writing-standard`](../spec-writing-standard/SKILL.md) Mode A (Initial Creation) before
continuing.

### Step 2: Determine which SPEC sections change

Use the lookup table in [`spec-writing-standard`](../spec-writing-standard/SKILL.md) Mode B
(Incremental Update, Step 1) to list the sections that must be updated. Write the list down before
touching any code.

### Step 3: Update the spec incrementally

Apply the targeted spec update using
[`spec-writing-standard`](../spec-writing-standard/SKILL.md) Mode B (Incremental Update). Only
the sections identified in Step 2 are changed.

For API specs, use [`api-spec-management`](../api-spec-management/SKILL.md).

The spec update must be committed **before** or **in the same commit as** the implementation code.
It must never be deferred to after the PR.

### Step 4: Define a verification test plan

For each spec section updated, state:

- **What to verify**: which contract assertions validate the change
- **How to verify**: unit / integration / contract test
- **Commands to run**: exact verification commands

Use [`contract-audit`](../contract-audit/SKILL.md) for contract consistency checks.

### Step 5: Implement to spec

- Write code that conforms to the updated spec — the spec is now the design artifact
- Follow TDD cycle (see [`tdd-red-green-refactor`](../tdd-red-green-refactor/SKILL.md))
- Build and verify (see [`repo-change-loop`](../repo-change-loop/SKILL.md))

### Step 6: Verify conformance

Run the full conformance verification loop after implementation:

- See [`spec-code-conformance`](../skills/spec-code-conformance/SKILL.md)
- Implementation is not complete until conformance is verified with zero gaps and regression tests
  pass

## Orchestrated Skills

| Skill                    | Role in this workflow                        |
| ------------------------ | -------------------------------------------- |
| `spec-writing-standard`  | SPEC.md incremental update and quality gates |
| `api-spec-management`    | API spec format and update workflow          |
| `contract-audit`         | Contract consistency verification            |
| `tdd-red-green-refactor` | Implementation cycle                         |
| `repo-change-loop`       | Build and verify loop                        |
| `spec-code-conformance`  | Post-implementation conformance verification |
