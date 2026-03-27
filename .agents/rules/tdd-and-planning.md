# TDD & Planning Rules

Rules for test-driven development and implementation planning.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

### Test-Driven Development

- Follow Kent Beck's Red-Green-Refactor cycle.
- Never write production code without a failing test that demands it.
- Never refactor while tests are failing.
- Bug fixes start with a test that reproduces the bug.
- **Pre-refactor rule**: Before modularizing or restructuring existing code, write characterization tests that capture current behavior. Commit tests before any extraction. See `pre-refactor-test-harness` skill.

### Planning Requirements

- Every development plan MUST include a **Test Strategy** section.
- The test strategy must specify: what to test, how to test (unit / integration / contract / E2E), and the verification commands to run.
- Plans without a test strategy are incomplete and must not be executed.
- For each task in the plan, test steps (write failing test → verify fail → implement → verify pass) must be explicit, not implied.
- When reviewing or approving a plan, verify the test strategy exists and covers the critical paths before proceeding.
- **Mechanical enforcement**: `pnpm harness:scan:test-plans` scans all documents in `docs/superpowers/plans/`, `docs/superpowers/specs/`, and `.agents/tasks/` for a test plan section (heading matching `## Test Plan`, `## Test Strategy`, `## Testing`, `## 테스트`, `## 검증`) with at least 50 characters of content. Documents without a qualifying test plan section cause the scan to fail.

### Plan Documentation Requirement

- Every implementation plan MUST be saved as a design document in `docs/plans/YYYY-MM-DD-<topic>-design.md` before execution begins.
- The document must include: goal, architecture, data flow, and affected files.
- Plans that exist only in conversation context are not considered finalized. The document is the SSOT for the plan.
- After implementation is complete, the relevant `packages/*/docs/SPEC.md` files MUST be updated to reflect the changes.
- A plan without a saved design document must not be executed. A completed implementation without updated SPEC.md is incomplete.
