# TDD & Planning Rules

Rules for test-driven development and implementation planning.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

### Test-Driven Development

- Follow Kent Beck's Red-Green-Refactor cycle.
- Never write production code without a failing test that demands it.
- Never refactor while tests are failing.
- Bug fixes start with a test that reproduces the bug.
- **Prove the regression test RED before it counts as verification (anti-accidental-green).** A test that
  verifies a defect fix MUST be demonstrated to FAIL against the pre-fix state — it must fail without the source
  change. This holds regardless of ordering: in a **fix-first** flow (bug found → fixed → test written), you
  MUST run the new test against the unfixed code (revert the fix, run against the merge-base, or use a fixture
  that reproduces the defect), confirm it FAILS, then restore and confirm it PASSES. A regression test that
  passes on both the buggy and the fixed code guards nothing and is false assurance — the fix is effectively
  unverified. The most common accidental-green shape is a test that asserts a **late invariant** both versions
  satisfy (e.g. checking a state only after the code path under test has already run), never exercising the
  window/branch the bug lived in. Record the RED→GREEN result as GATE-VERIFY evidence.
- Agent/tool orchestration bugs require behavior tests that prove trigger, runtime event, terminal result or timeout, session persistence, and parent-turn follow-up. A test that only checks parser output or spawned-job count is incomplete.
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
