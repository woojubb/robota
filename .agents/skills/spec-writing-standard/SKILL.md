---
name: spec-writing-standard
description: Use when creating or updating a package SPEC.md. Defines required sections, quality gates, and drift detection workflow.
---

## Rule Anchor

- "Owner Knowledge Policy" in `AGENTS.md`
- "Spec Quality Gate" in `AGENTS.md`
- "Continuous Improvement" in `AGENTS.md`

## Use This Skill When

- Creating a new `docs/SPEC.md` for a workspace package or app.
- Reviewing or expanding an existing SPEC.md that is too minimal.
- Checking whether a SPEC.md reflects the current implementation after significant changes.

## Preconditions

- The workspace package exists in `pnpm-workspace.yaml`.
- `docs/README.md` exists and references `SPEC.md`.
- You have read the package source code sufficiently to describe its architecture.

## Execution Steps

1. **Read current source**: Understand the package's directory structure, key classes, interfaces, and exports.

2. **Check existing SPEC.md**: Read `docs/SPEC.md` if it exists. Identify missing required sections.

3. **Write or update required sections** (all are mandatory):

   - **Scope**: What the package owns (2-4 sentences).
   - **Boundaries**: What the package does NOT own and where those responsibilities live.
   - **Architecture Overview**: Layer structure, key components, design patterns used.
   - **Type Ownership**: SSOT types this package defines. Table format: Type | Location | Purpose.
   - **Public API Surface**: Exported classes, functions, types. Table format: Export | Kind | Description.
   - **Extension Points**: How consumers extend behavior (abstract classes, interfaces, strategies).
   - **Error Taxonomy**: Error types with codes, categories, recoverability. Table format if applicable.
   - **Test Strategy**: Current test files, scenario verification, coverage gaps.
   - **Class Contract Registry**: Interface implementations, inheritance chains, and cross-package port consumers for this package.

4. **Write optional sections** (include when applicable):

   - **Plugin/Hook Contract**: If the package has a plugin or hook system.
   - **Event Architecture**: If the package emits or consumes events.
   - **State Lifecycle**: If the package manages stateful objects with transitions.
   - **Dependencies**: Production dependencies and key peer contracts.
   - **Configuration**: Required and optional configuration options.

5. **Verify consistency**: Ensure SPEC.md content matches actual code.
   - Type names in the ownership table must exist in source.
   - Exported symbols in the API surface must exist in `index.ts`.
   - Error classes in the taxonomy must exist in the error module.

6. **Run harness scan**: `pnpm harness:scan:specs` to verify the spec is detected.

## Stop Conditions

- SPEC.md contains fewer than 3 of the 8 required sections.
- Type ownership table references types that do not exist in source.
- Public API surface lists exports not present in `index.ts`.
- SPEC.md describes architecture that contradicts actual code structure.
- Class Contract Registry is inconsistent with `implements-audit` output.

## Checklist

- [ ] Scope section defines ownership clearly
- [ ] Boundaries section names concrete packages that own excluded responsibilities
- [ ] Architecture overview includes layer structure or component diagram
- [ ] Type ownership table lists all SSOT types with file locations
- [ ] Public API surface covers primary exports (classes, factories, key types)
- [ ] Extension points list abstract classes or interfaces consumers implement
- [ ] Error taxonomy covers package-specific error types
- [ ] Test strategy describes current coverage and gaps
- [ ] Class Contract Registry covers all implements/extends in this package
- [ ] All referenced types, exports, and errors exist in source code
- [ ] `pnpm harness:scan:specs` passes

## Anti-Patterns

- Writing a SPEC.md with only "Scope" and "Boundaries" (too minimal to be useful).
- Duplicating implementation details that belong in code comments.
- Listing every internal type in the ownership table (only SSOT types).
- Writing aspirational architecture that does not match current code.
- Copying SPEC.md content between packages without adjusting ownership.

## Related Harness Commands

- `pnpm harness:scan:specs` — verify SPEC.md existence and docs/README.md reference
- `pnpm harness:review -- --scope <pkg>` — review changes including spec drift
