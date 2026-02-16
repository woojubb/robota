---
name: semver-api-surface
description: Manages semantic versioning and public API surfaces for multi-package monorepos. Use when adding, changing, or removing exported interfaces, types, or functions to determine version impact and maintain compatibility.
---

# Semantic Versioning & API Surface Management

## Rule Anchor
- `.cursor/rules/project-structure-rules.mdc`
- `.cursor/rules/type-ssot-rules.mdc`

## Use This Skill When
- Changing a package's barrel export (index.ts).
- Adding, removing, or modifying public interfaces or types.
- Deciding whether a change is major, minor, or patch.
- Planning a deprecation-to-removal lifecycle.
- Coordinating version bumps across dependent packages.

## Core Principles
1. **semver contract**: major = breaking, minor = additive, patch = fix.
2. **Public surface = barrel export**: only what index.ts exports is public API.
3. **Additive is safe**: new exports and optional properties are minor.
4. **Removal is breaking**: removing or renaming an export is major.
5. **Deprecate before remove**: mark deprecated for at least one minor version before removing.

## Breaking Change Criteria
| Change | Impact | Version |
|--------|--------|---------|
| Remove exported type/interface/function | consumers break | **major** |
| Rename exported symbol | consumers break | **major** |
| Change required parameter type | consumers break | **major** |
| Add required property to interface | implementers break | **major** |
| Add optional property to interface | compatible | minor |
| Add new export | compatible | minor |
| Fix bug without API change | compatible | patch |
| Internal refactor (no export change) | compatible | patch |

## Workflow
1. Before making a change, check if the affected symbol is in barrel export.
2. If public: classify the change using the table above.
3. If breaking: consider deprecation path (add new, deprecate old, remove later).
4. Update CHANGELOG or ADR with the change and version impact.
5. Coordinate dependent package version bumps.

## Deprecation Lifecycle
```ts
// Step 1: Add new API alongside old (minor version bump)
/** @deprecated Use `executeTask` instead. Will be removed in next major. */
export function runTask(input: TaskInput): Promise<TaskResult> {
  return executeTask(input);
}
export function executeTask(input: TaskInput): Promise<TaskResult> { /* ... */ }

// Step 2: Remove old API (major version bump)
// export function runTask — removed
export function executeTask(input: TaskInput): Promise<TaskResult> { /* ... */ }
```

## Monorepo Coordination
- Use `workspace:*` protocol for internal dependencies.
- When `dag-core` has a breaking change, all dependent `dag-*` packages must bump.
- Use pnpm catalog for shared external dependency versions.
- Run `pnpm --filter @robota-sdk/* build` to verify no cross-package breakage.

## Checklist
- [ ] Changed symbol is classified as public (in barrel export) or internal.
- [ ] Breaking changes have a deprecation step or documented justification.
- [ ] Version bump matches the change classification.
- [ ] Dependent packages are updated and build successfully.
- [ ] CHANGELOG or ADR records the change.

## Anti-Patterns
- Removing public exports without a major version bump.
- Adding required properties to public interfaces as a minor change.
- Skipping deprecation and jumping straight to removal.
- Independent package versions that drift without coordination.
- Exporting internal implementation details in barrel exports.
