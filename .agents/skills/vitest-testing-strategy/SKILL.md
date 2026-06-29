---
name: vitest-testing-strategy
description: Defines a practical testing strategy for TypeScript and JavaScript using Vitest across unit, integration, and type-level tests. Use when adding features, refactoring, or preventing regressions with fast feedback loops.
---

# Vitest Testing Strategy

## Rule Anchor

- `.agents/rules/verification.md` > "Build Requirements"
- `.agents/project-structure.md` > package dependency rules

## Use This Skill When

- Adding or refactoring TS/JS logic that needs regression safety.
- Reorganizing test layers for faster and more reliable feedback.
- Validating runtime behavior and compile-time type contracts.

## Test Pyramid for TS/JS

1. Unit tests: pure logic and small components.
2. Integration tests: module boundaries, adapters, and I/O wiring.
3. Type tests: compile-time contracts for public APIs.

## Workflow

1. Classify change scope (logic, boundary, API type surface).
2. Add unit tests for deterministic core behavior first.
3. Add integration tests for key side-effect paths.
4. Add type assertions for exported contracts when applicable.
5. Run targeted tests, then full package test run.

## CLI and Headless Paths

- CLI, transport, `InteractiveSession`, command, model-routed tool, streaming, provider setup, permission, or session persistence changes need at least one headless integration test when the behavior can run outside the TUI.
- Prefer an injected provider fixture over real API keys.
- Assert structured evidence such as tool schemas, tool result messages, command or skill activation events, persisted records, exit codes, or JSON/stream-json output.

## Reference Patterns

- Unit: table-driven cases with clear input/output pairs.
- Integration: minimal fixture setup, real wiring for one boundary.
- Type-level: `expectTypeOf` for generic and inference guarantees.

## Live State-Mutation Seams (cold-state coverage)

A "live state-mutation seam" is any path that mutates a collaborator's runtime configuration
**after construction** — e.g. switching model/effort on a running agent, re-applying a preset,
hot-swapping a permission mode. These collaborators often **initialize lazily** (the real work
happens on first use, not in the constructor), so the seam has two distinct states:

- **warm**: the collaborator has been used at least once (fully initialized).
- **cold**: the collaborator was constructed but never used — initialization has not run yet.

Rules:

- **Always cover the cold path with a real collaborator (no mock).** Build the real object,
  do NOT trigger its first use, then exercise the seam. The cold path is where lazy-init guards
  fire, and it is the path users hit (e.g. `/preset` immediately after launch).
- **If you must mock the collaborator, the mock MUST reproduce the real method's preconditions.**
  A mock whose `setX()` ignores the real "must be fully initialized" guard turns a red test green —
  you have replaced the buggy collaborator with a compliant fake and the bug walks straight to
  production. Mocking the collaborator that owns the bug hides the bug.
- Reference regression test: `packages/agent-session/src/__tests__/apply-model-options-cold-session.test.ts`
  (real `Robota`, never calls `run()`, asserts `applyModelOptions` succeeds on a cold session).
  Incident + fix: `/preset` `ConfigurationError: Agent must be fully initialized before changing
model configuration` (2026-06-14). See `common-mistakes.md` #60.

## Worker-Thread Environment Gotchas

- `vi.stubEnv('HOME', …)` (and any `process.env` mutation) does NOT propagate to native APIs
  such as `os.homedir()` inside vitest worker threads — the native environment is a snapshot.
  Tests that "stub HOME" and then call code using `os.homedir()` silently exercise the real
  home directory.
- Never freeze user/project paths into module-level constants
  (`const MARKER = userPaths().onboarded` at top level) — the path is resolved at import time
  and cannot be redirected by any test.
- Correct pattern: resolve lazily and accept an injectable default parameter, e.g.
  `export function isFirstRun(markerPath = userPaths().onboarded)` — production callers pass
  nothing; tests pass a temp path (incident + fix: agent-cli `startup/first-run.ts`,
  2026-06-11).

## Checklist

- [ ] New behavior has at least one unit test.
- [ ] Critical side effects have integration coverage.
- [ ] CLI-reachable behavior has headless integration coverage when applicable.
- [ ] Public type contracts are validated when changed.
- [ ] Tests avoid over-mocking implementation details.
- [ ] Live state-mutation seams have cold-state coverage with a real collaborator.
- [ ] Mocks of guarded collaborators reproduce the real method's preconditions.
- [ ] Multi-step interaction tests assert the expected prompts/requests were issued (count + order + each one's shape), not only the final outcome — a scripted input double that resolves `cancelled` once exhausted otherwise hides a dropped intermediate step. See `common-mistakes.md` #71.
- [ ] Tests that write files target an isolated temp dir (`mkdtempSync`), never a relative/tracked path (a relative `./x.json` resolves to the package cwd and can dirty a tracked artifact, tripping the pre-push clean-tree gate).
- [ ] Failure messages are readable and actionable.

## Anti-Patterns

- Only snapshot tests without behavioral assertions.
- Massive integration suites replacing all unit tests.
- Tests tightly coupled to private implementation details.
- Skipping type-level tests when changing exported generic types.
- Mocking the very collaborator whose guard owns the bug, so the mock never enforces the
  precondition that fails in production (mock-the-buggy-collaborator).
- Testing a post-construction state-mutation seam only on the warm path, never on the cold
  (never-used / lazy-init-pending) path.
