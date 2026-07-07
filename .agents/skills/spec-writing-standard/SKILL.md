---
name: spec-writing-standard
description: Use when creating a new SPEC.md or incrementally updating an existing one. Covers both initial authoring and the ongoing incremental-update workflow that keeps the spec live.
---

## Rule Anchor

- "Live Spec Policy" in `.agents/rules/spec-workflow.md`
- "Owner Knowledge Policy" in `AGENTS.md`

## Use This Skill When

- Creating a new `docs/SPEC.md` for a workspace package or app. → use **Initial Creation Mode**.
- Updating an existing SPEC.md because a PR changed behavior, exports, types, or contracts. → use **Incremental Update Mode**.
- Recovering a drifted SPEC.md that has fallen out of sync with its package. → use **Drift Recovery Mode**.

---

## Mode A — Initial Creation

Use when no `docs/SPEC.md` exists for the package.

### Preconditions

- The workspace package exists in `pnpm-workspace.yaml`.
- `docs/README.md` exists and references `SPEC.md`.
- You have read the package source code sufficiently to describe its architecture.

### Steps

1. **Read current source**: Understand the package's directory structure, key classes, interfaces,
   and exports.

2. **Write all required sections** (all mandatory):
   - **Scope**: What the package owns (2–4 sentences).
   - **Boundaries**: What the package does NOT own and where those responsibilities live.
   - **Architecture Overview**: Layer structure, key components, design patterns used.
   - **Type Ownership**: SSOT types this package defines. Table: Type | Location | Purpose.
   - **Public API Surface**: Exported classes, functions, types. Table: Export | Kind | Description. The table MUST list every runtime export of the package entry (`src/index.ts`) — the reverse-edge `check-spec-public-surface` gate enforces this completeness contract.
   - **Extension Points**: How consumers extend behavior (abstract classes, interfaces, strategies).
   - **Error Taxonomy**: Error types with codes, categories, recoverability. Table if applicable.
   - **Test Strategy**: Current test files, scenario verification, coverage gaps.
   - **Class Contract Registry**: Interface implementations, inheritance chains, cross-package port
     consumers.

3. **Write applicable optional sections**:
   - **Plugin/Hook Contract** — if the package has a plugin or hook system.
   - **Event Architecture** — if the package emits or consumes events.
   - **State Lifecycle** — if the package manages stateful objects with transitions.
   - **Dependencies** — production dependencies and key peer contracts.
   - **Configuration** — required and optional configuration options.

4. **Verify consistency**: Every type name, export symbol, and error class referenced in the spec
   must exist in source.

5. **Run harness scan**: `pnpm harness:scan:specs`.

---

## Mode B — Incremental Update

Use on every PR that changes package behavior, exports, types, or contracts. The spec is updated
**before** implementation code is written (see Live Spec Policy).

This mode is surgical: only sections affected by the change are touched. Unaffected sections are
not rewritten.

### Step 1 — Identify affected sections

Use the table below to determine which sections need updating:

| What is changing in this PR                    | Section(s) to update                    |
| ---------------------------------------------- | --------------------------------------- |
| New or removed public export                   | Public API Surface                      |
| New or changed type or interface               | Type Ownership                          |
| New class or changed `implements`/`extends`    | Class Contract Registry                 |
| New or changed error type or code              | Error Taxonomy                          |
| New or changed lifecycle event                 | State Lifecycle / Event Architecture    |
| Changed behavioral semantics                   | Architecture Overview, relevant section |
| New extension point (abstract class, callback) | Extension Points                        |
| Changed configuration options                  | Configuration                           |
| Changed test strategy or coverage              | Test Strategy                           |

### Step 2 — Read the current SPEC sections

Read only the sections identified in Step 1. Do not read sections that are not affected.

### Step 3 — Write the delta

For each affected section:

- **New row in a table**: add the row. Do not renumber or reformat existing rows.
- **Changed row**: edit that row only.
- **Removed export or type**: delete the row. If a section becomes empty, state "None" or remove
  the section heading if optional.
- **Narrative paragraph**: edit the relevant sentence or paragraph. Do not rewrite the section.

### Step 4 — Consistency check

For every item added or changed in the spec:

- Type names must exist (or will exist in the same PR) in source.
- Export symbols must appear (or will appear) in `index.ts`.
- Error classes must exist (or will exist) in the error module.

### Step 5 — Commit the spec update with the implementation

The spec change and the implementation change belong in the same commit or the same PR. Never
split them into separate PRs unless the spec update is a drift recovery (see Mode C).

---

## Mode C — Drift Recovery

Use when a SPEC.md has accumulated drift across multiple PRs that skipped updates.

1. **Enumerate drift**: Run `pnpm harness:review -- --scope <pkg>` and read the current SPEC
   section by section against the actual code.
2. **List gaps**: Create a table of spec assertions that no longer match the code, and code
   behaviors that are not in the spec.
3. **Resolve each gap as a targeted incremental update** (Mode B, Step 3). Fix the spec to match
   the current code — drift recovery corrects the spec to describe reality.
4. **Re-run consistency check** (Mode B, Step 4) until zero gaps remain.
5. **Run full conformance verification**: `pnpm --filter <pkg> build && pnpm --filter <pkg> test`.

Drift recovery is a dedicated PR. Do not mix drift recovery with feature work.

---

## Required Sections Reference

All nine sections below are mandatory in every complete SPEC.md:

| #   | Section                 | Purpose                            |
| --- | ----------------------- | ---------------------------------- |
| 1   | Scope                   | What the package owns              |
| 2   | Boundaries              | What it does not own               |
| 3   | Architecture Overview   | Layer structure and key components |
| 4   | Type Ownership          | SSOT types with locations          |
| 5   | Public API Surface      | Exported symbols                   |
| 6   | Extension Points        | How consumers extend the package   |
| 7   | Error Taxonomy          | Error types and codes              |
| 8   | Test Strategy           | Coverage and gaps                  |
| 9   | Class Contract Registry | implements/extends inventory       |

---

## Stop Conditions

- SPEC.md contains fewer than 3 of the 9 required sections (initial creation incomplete).
- Type ownership table references types that do not exist in source.
- Public API surface lists exports not present in `index.ts`.
- SPEC.md describes architecture that contradicts actual code structure.
- Class Contract Registry is inconsistent with `implements-audit` output.
- Incremental update rewrote sections unaffected by the current change (scope creep).

## Checklist

### Initial Creation

- [ ] All 9 required sections present
- [ ] Scope defines ownership clearly
- [ ] Boundaries names concrete packages that own excluded responsibilities
- [ ] Architecture overview includes layer structure or component diagram
- [ ] Type ownership lists all SSOT types with file locations
- [ ] Public API Surface covers primary exports
- [ ] Extension Points lists abstract classes or interfaces consumers implement
- [ ] Error taxonomy covers package-specific error types
- [ ] Test strategy describes current coverage and gaps
- [ ] Class Contract Registry covers all implements/extends in this package
- [ ] All referenced types, exports, and errors exist in source
- [ ] `pnpm harness:scan:specs` passes

### Incremental Update

- [ ] Affected sections identified using the lookup table
- [ ] Only affected sections updated (no unrelated rewrites)
- [ ] All new/changed items verifiable in source (or in the same PR)
- [ ] Spec update committed in the same PR as implementation
- [ ] `pnpm harness:scan:specs` passes

## Anti-Patterns

- Treating SPEC.md as a one-time artifact — the spec is live and must evolve with every change.
- Back-filling the spec after implementation — always update spec first.
- Rewriting the whole document for a localized change — incremental updates only.
- Writing a SPEC.md with only "Scope" and "Boundaries" (too minimal).
- Writing aspirational architecture that does not match current code.
- Duplicating implementation details that belong in code comments.
- Listing every internal type in the ownership table (only SSOT types).

## Related Harness Commands

- `pnpm harness:scan:specs` — verify SPEC.md existence and docs/README.md reference
- `pnpm harness:review -- --scope <pkg>` — review changes including spec drift
