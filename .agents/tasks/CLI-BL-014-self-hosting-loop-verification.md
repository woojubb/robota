# CLI-BL-014: Self-hosting Loop Verification

## Context

To achieve the "Self-hosting" goal, an agent must be able to modify its own source code and then run a build/test cycle. This presents a unique challenge: how do we ensure that a partial or broken state during the 'write' phase doesn't prevent the agent from finishing the 'verify' phase?

## Objective

Define the mechanism to safely execute the "Edit -> Build -> Verify" loop where the tool being modified is the same as the engine running the process.

## Key Challenges & Questions

1. **Atomic Swaps**: How can we ensure that a `write` operation doesn't break the current running process before it can finish its task?
2. **Dependency Integrity**: When an agent modifies a core package, how do we verify that the global monorepo-wide dependencies remain intact?
3. **Execution Context**: If the `pnpm build` command requires the new code to be valid, but the current process is still using the old code, how do we manage the handoff?

## Requirements for Completion (Definition of Done)

- [ ] A clear specification for 'Atomic Write' operations in a monorepo.
- [ ] A verification protocol that ensures `pnpm build` can succeed even when parts of the codebase are in flux.
- [ ] Integration with our CI/CD-like local environment to prevent "suicide" (the agent accidentally deleting its own ability to run).

## Test Plan

- Add unit tests for any atomic write planner or handoff state machine introduced by the implementation.
- Add integration tests that simulate edit/build/verify sequencing without replacing the running process.
- Run affected package `test`, `typecheck`, and `build`, then run `pnpm harness:scan`.

## Notes

This task is a prerequisite for all recursive development tasks.
