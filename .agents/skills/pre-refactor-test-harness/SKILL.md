---
name: pre-refactor-test-harness
description: Before modularizing or refactoring a package, analyze the code for extraction points, write characterization tests for current behavior, then modularize under test protection. Use when a package has monolithic files that need to be broken into testable modules.
---

# Pre-Refactor Test Harness

## Rule Anchor

- `AGENTS.md` > "Test-Driven Development"
- `AGENTS.md` > "Build Requirements"
- `AGENTS.md` > "No Fallback Policy"

## Use This Skill When

- A package has monolithic files (>300 lines) with mixed responsibilities.
- User requests modularization, refactoring, or "clean up" of a package.
- About to restructure code that lacks adequate test coverage.
- **Trigger phrase patterns**: "modularize", "break up", "split into modules", "refactor [package]", "clean up [file]", "too much in one file".

## Core Principle

**Never refactor without tests. Never modularize without first proving the current behavior is captured.**

The sequence is always: **Analyze → Test → Extract → Verify**.

## Execution Steps

### Phase 1: Analysis (no code changes)

1. **Read the target files** and catalog each responsibility block:
   - Pure logic (no I/O, no framework deps) → immediately extractable
   - I/O operations (fs, network, process) → extract behind interface
   - Framework-coupled (React hooks, state) → extract logic, leave glue
   - UI rendering → test only if behavior-critical

2. **Classify each block** into a table:

   | Block | Lines | Dependencies | Extractable | Test Priority |
   |-------|-------|-------------|-------------|---------------|
   | (name) | ~N | pure/IO/React | yes/partial/no | P1/P2/P3 |

3. **Identify extraction targets** — functions or logic that can become:
   - A pure function in a new module (highest value)
   - A class/module behind an interface
   - A custom hook with testable logic separated

4. **Present the analysis to the user** with a proposed module structure and ask for approval before proceeding.

### Phase 2: Characterization Tests (before any refactoring)

5. **Write tests for current behavior** of each P1 extraction target:
   - Test the function/logic as-is, even if inline
   - If inline and untestable, write the test for the extracted signature first (RED)
   - Focus on: input → output contracts, edge cases, error paths

6. **Run tests** — all must pass (or fail predictably for RED tests):
   ```bash
   pnpm --filter @robota-sdk/<pkg> test
   ```

7. **Commit tests separately** before any extraction:
   - Commit message: `test(<pkg>): add characterization tests for <target> before refactor`
   - This preserves a rollback point

### Phase 3: Extract (one module at a time)

8. **Extract one module** — move the logic to its new file:
   - Pure function extraction: move function, update imports
   - Interface extraction: define interface, implement, inject
   - Keep the original call site as a thin wrapper initially

9. **Run tests after each extraction**:
   ```bash
   pnpm --filter @robota-sdk/<pkg> test
   pnpm --filter @robota-sdk/<pkg> build
   ```

10. **Commit each extraction individually**:
    - Commit message: `refactor(<pkg>): extract <module> from <source>`

11. **Repeat steps 8-10** for each extraction target.

### Phase 4: Verify

12. **Run full verification**:
    ```bash
    pnpm build
    pnpm test
    pnpm typecheck
    ```

13. **Update SPEC.md** — add new files to File Structure, update module descriptions.

14. **Summarize** what was extracted, what tests were added, and what remains.

## Stop Conditions

- Do NOT extract code without existing or new tests covering it.
- Do NOT extract multiple modules in one commit.
- Do NOT change behavior during extraction — pure move only.
- Do NOT skip the analysis phase — present the plan first.
- Do NOT proceed without user approval of the extraction plan.

## Extraction Priority Rules

| Priority | Criteria | Example |
|----------|----------|---------|
| **P1** | Pure function, no deps, high reuse | `extractToolCalls()`, `formatTokenCount()` |
| **P2** | I/O behind interface, moderate complexity | `SettingsIO.read()`, `PrintTerminal` |
| **P3** | Framework-coupled, needs hook/state refactor | `usePermissionQueue`, `useSessionRunner` |

- Always extract P1 first — highest test value, lowest risk.
- P2 requires interface definition before extraction.
- P3 may require architectural decisions — discuss with user.

## Anti-Patterns

- **Big bang refactor**: extracting everything at once without incremental tests.
- **Test-after-extract**: moving code first, writing tests second (breaks rollback safety).
- **Behavior change during extraction**: "while I'm here, let me also fix..."
- **Skipping analysis**: jumping to extraction without understanding dependencies.
- **Over-extraction**: creating a module for 5 lines of code that's used once.

## Checklist

- [ ] Target file(s) read and responsibilities cataloged
- [ ] Extraction targets classified with priority (P1/P2/P3)
- [ ] Analysis presented to user and approved
- [ ] Characterization tests written for P1 targets
- [ ] Tests committed before any extraction
- [ ] Each extraction is one commit with passing tests
- [ ] SPEC.md updated with new file structure
- [ ] Full build + test + typecheck passes

## Related Skills

- `tdd-red-green-refactor` — TDD cycle for new behavior after extraction
- `repo-change-loop` — build/test/verify workflow
- `spec-code-conformance` — SPEC update after structural changes
- `vitest-testing-strategy` — testing patterns and conventions
