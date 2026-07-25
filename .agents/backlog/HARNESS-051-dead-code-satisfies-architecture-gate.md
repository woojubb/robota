---
id: HARNESS-051
title: An architecture gate is satisfied vacuously by dead code, and the linter was blind to the code that hid it
status: todo
priority: medium
type: INFRA
created: 2026-07-26
---

## Problem

Three findings from SEC-005's dead-code sweep, related by a single theme: **a check that passes on
something other than what it means to check.**

### 1. A hard architecture gate is satisfied by dead code

`packages/agent-playground/src/lib/playground/robota-executor/` contains `agent-session.ts` — an
**eight-line file consisting only of imports** — and `remote-providers.ts`, holding two functions
nobody calls. Deleting them looks obviously safe and is not: `harness:verify-like-ci` goes red.

- The `agent-server-boundary` gate requires the package to import `@robota-sdk/agent-remote-client`.
  The **only** such import in the package is the never-called `createRemoteExecutor`. So the
  architecture invariant is currently satisfied **vacuously, by dead code**.
- An `orphan-exports` cascade follows: the imports-only file is the sole remaining reference keeper
  for `createToolFromCard`, `normalizeTools`, `REMOTE_EXECUTOR_TIMEOUT_MS`, and transitively
  `ToolRegistry`.

A gate that an import statement satisfies is checking that a _token appears_, not that a _seam is
wired_. The gate is not wrong to exist; it is measuring the wrong thing, and the dead code is the
evidence.

Resolving it is an architecture decision, not a cleanup: either wire the seam for real, or delete the
chain and amend the boundary rule accordingly. Four CodeQL alerts stay open until it is made.

### 2. ESLint was configured not to look where most of the defects were

The root ESLint configuration sets `no-unused-vars` to `off` for test files. **65 of the 91 alerts
SEC-005 triaged were in tests** — the linter never looked at them. That is how two tests that
asserted nothing survived, one of them literally `expect(true).toBe(true)` beside an unused counter,
both proven inert by source mutation (the suites stayed green with the behaviour under test removed).

The exemption presumably exists for a reason worth preserving — test fixtures legitimately bind
values they do not read. That reason should be re-established or the exemption narrowed, rather than
left as a blanket off for the largest body of code in the repo.

### 3. `verify-change.mjs` writes a `passed` field that is structurally always `true`

Every `allPassed = false` at lines 164/175/195/259/293 is immediately followed by `throw`, so control
never reaches the read at line 361 with a false value. The report's `passed` field can only ever be
written as `true`.

**Currently harmless, and worth stating why precisely:** no consumer reads it — `review-change.mjs`,
`collect-run-context.mjs` and `check-plan.mjs` were checked and none touches the field. The throw
propagates, so the process still fails. This is not a live fail-open; it is a field that will become
one the moment anything trusts it, which is exactly the shape INFRA-048 and INFRA-050 closed
elsewhere. Fix it or remove it — a value that cannot vary should not be reported as if it could.

## Also recorded by SEC-005, unresolved

- `packages/agent-core/src/testing/cassette-provider.ts` contains literal NUL bytes (`SCRUB_TOKEN` is
  `'\0SCRUBBED\0'`), so the file reads as binary to `grep` and `file`. Left alone deliberately:
  changing it invalidates recorded cassette hashes. Worth a decision, since a source file invisible
  to text tooling is invisible to every scan built on them.
- `config-validation.ts` logs a fallback it does not apply.
- `plugins.test.ts` has zero error-path assertions against seven `throw` sites.
- 13 dead-code alerts remain under `scripts/**` (outside SEC-005's ownership).

## Acceptance

- [ ] The `agent-server-boundary` gate either verifies a wired seam or its requirement is restated to
      match what it can actually check — with the playground's dead chain removed either way.
- [ ] The test-file `no-unused-vars` exemption is justified in place or narrowed, and the alert count
      in tests is measured after the change.
- [ ] `verify-change.mjs`'s `passed` field varies with the outcome, or is gone.

## References

- `.agents/backlog/SEC-005-codeql-dead-code-backlog.md`
- `scripts/harness/verify-change.mjs`, the `agent-server-boundary` and `orphan-exports` scans
