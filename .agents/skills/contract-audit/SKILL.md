---
name: contract-audit
description: Use when reviewing a package's class contract relationships (interface implementations, inheritance chains, cross-package port consumers) and updating its SPEC.md Class Contract Registry.
---

## Rule Anchor

- "Type System (Strict)" in `AGENTS.md`
- "Spec Quality Gate" in `AGENTS.md`
- `type-boundary-and-ssot` skill
- `architecture-patterns` skill
- `spec-writing-standard` skill

## Use This Skill When

- Adding or updating a Class Contract Registry in a package's `docs/SPEC.md`.
- Reviewing whether a package's classes respect ownership boundaries and single responsibility.
- Verifying that interface implementations match their contracts after refactoring.
- Auditing cross-package port-to-adapter relationships.

## Preconditions

- The target package exists in `pnpm-workspace.yaml`.
- `docs/SPEC.md` exists (create using `spec-writing-standard` if missing).
- `scripts/audit/audit-implements.mjs` is available and runnable.

## Tier Priority

Review packages in dependency order so upstream contracts are established first.

| Tier | Packages | Rationale |
|------|----------|-----------|
| 1 | dag-core, agents | Contract owners (ports, abstract bases) |
| 2 | dag-runtime, dag-worker, dag-scheduler, openai, anthropic, google | Primary implementors |
| 3 | dag-api, dag-projection, dag-nodes, dag-designer | Composition and specialization |
| 4 | sessions, team, remote, dag-server-core, playground, bytedance | Infrastructure and leaf |

## Execution Steps

1. **Select target package** using tier priority above.

2. **Collect contracts mechanically**:
   ```bash
   node scripts/audit/audit-implements.mjs
   ```
   Filter output for the target package. Extract all `implements` and `extends` relationships.

3. **Classify each contract**:
   - **Port interface**: Dependency inversion boundary (e.g., `IStoragePort`).
   - **Extension point**: Abstract base for consumer specialization (e.g., `AbstractNodeDefinition`).
   - **Strategy/Policy**: Swappable behavior (e.g., `IRetryPolicy`).
   - **Internal contract**: Package-internal interface not exported.

4. **Build registry tables** for the Class Contract Registry section:

   ### Interface Implementations
   | Interface | Implementor | Kind | Location |
   |-----------|------------|------|----------|

   ### Inheritance Chains
   | Base | Derived | Location | Notes |
   |------|---------|----------|-------|

   ### Cross-Package Port Consumers
   | Port (Owner) | Adapter (Consumer Package) | Location |
   |--------------|---------------------------|----------|

5. **Update SPEC.md**: Add or replace the `## Class Contract Registry` section.

6. **Verify responsibility**:
   - Each class has a single, clear responsibility.
   - No class reaches across package boundaries to access internal state.
   - Port implementations do not leak domain logic from the adapter layer.

7. **Verify encapsulation**:
   - Internal types are not exported via barrel (`index.ts`).
   - Mutable internal state is not exposed through public getters.
   - Construction uses DI; no hard-coded dependencies on concrete classes.

8. **Identify refactoring needs**: If violations are found, document them and apply fixes using `repo-change-loop` skill.

9. **Cross-check with audit tool**:
   ```bash
   node scripts/audit/audit-implements.mjs
   ```
   Confirm the Class Contract Registry matches the audit output.

## Stop Conditions

- Class Contract Registry tables are empty for a package that has `implements` or `extends` relationships.
- Registry lists a class or interface that does not exist in source.
- Registry omits a class that appears in `implements-audit` output for the package.
- A class implements an interface from a package it does not declare as a dependency.
- Cross-package port consumer table is missing when the package imports ports from another package.

## Checklist

- [ ] `implements-audit` output reviewed for the target package
- [ ] All `implements` relationships documented in Interface Implementations table
- [ ] All `extends` relationships documented in Inheritance Chains table
- [ ] Cross-package port consumers identified and documented
- [ ] Each contract classified (port, extension point, strategy, internal)
- [ ] Single responsibility verified for each class
- [ ] No internal types leaked through barrel exports
- [ ] SPEC.md Class Contract Registry matches audit output
- [ ] `pnpm build` passes after any changes
- [ ] `pnpm harness:scan` passes

## Anti-Patterns

- Listing every TypeScript interface (only list behavioral contracts, not data shapes).
- Including test doubles in the main registry (note them separately if needed).
- Documenting implementation details instead of contract relationships.
- Skipping cross-package analysis for packages that consume ports.
