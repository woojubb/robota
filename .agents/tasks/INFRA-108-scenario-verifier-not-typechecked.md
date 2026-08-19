---
title: 'INFRA-108: a breaking signature change reached develop because packages/*/examples is typechecked by nobody'
status: in-progress
created: 2026-08-20
priority: high
urgency: now
area: packages/agent-command
depends_on: []
---

# INFRA-108: the scenario verifier awaits `createSession`, and the gap that let it break

## Objective

`packages/agent-command`'s `scenario:verify` fails on a clean `origin/develop`, so every branch
rebased onto develop inherits a red `quality` check for a defect it did not introduce.

## What broke

PR #1885 (ARCH-035) changed `createSession` from a synchronous function to an `async` one. One
caller was not updated: `readSystemMessage` in
`packages/agent-command/examples/semantic-command-role-scenario-helpers.ts` did
`const created = createSession({...})` and then read `created.session` off the unawaited promise.

`created.session` is `undefined`, so the scenario threw — but not where the mistake was:

| where it was reported                  | what it said                                               |
| -------------------------------------- | ---------------------------------------------------------- |
| `verify-semantic-command-roles.ts:198` | `Cannot read properties of undefined (reading 'shutdown')` |
| the actual failure, two frames earlier | `undefined` has no `getSystemMessage`                      |

The reported frame is in the `finally` block: the scenario's cleanup loop does `session.shutdown()`
over an array that now holds an `undefined` the try block pushed, and that TypeError REPLACES the
original one. The message names a cleanup step that was never the problem.

## Measured, not assumed

| probe                                                       | result                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm scenario:verify` on a detached clean `origin/develop` | fails — the defect is develop's, not any branch's                       |
| the same, with the `finally` loop null-guarded              | reveals the real frame in `readSystemMessage`                           |
| `packages/agent-command/tsconfig.json`                      | `include: ["src/**/*"]` — `examples/` is outside it                     |
| root `examples:typecheck`                                   | `pnpm --filter "./examples/**" run typecheck` — the ROOT workspace only |

So the compiler never reads `packages/*/examples/`, and neither does the `examples-typecheck` CI job
that appears to cover it by name. Nine packages carry such a directory. A signature change to a
published function can break every one of them and still go green.

## Approach

Two separable things, and this item does only the first:

1. **The break** — `readSystemMessage` becomes `async` and awaits, and its four call sites await it.
   That is the whole fix; nothing else about the scenario changes.
2. **The gap** — bringing `packages/*/examples/` under a typecheck. Filed separately, because it is a
   nine-package change whose blast radius has to be measured against a full declaration build before
   anyone can say what it costs, and develop is red NOW.

## Plan

- [x] TC-01: `pnpm scenario:verify` in `packages/agent-command` passes.
- [x] TC-02: the failure was reproduced on a clean detached `origin/develop` FIRST, so the fix is
      attributed to the right change.
- [x] TC-03: the real frame was established by unmasking it, not by inference.
- [x] TC-04: `pnpm harness:pre-push` is green.
- [ ] TC-05: the typecheck gap is filed as its own issue.

## Test Plan

The scenario verifier is itself the test: it is an executable scenario whose exit code is the
assertion. It fails on develop and passes here, and both halves were run.

Red-proofed in both places the `await` matters, one at a time:

| await removed                                | what the scenario reported                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `await createSession(...)` in the helper     | `Cannot read properties of undefined (reading 'shutdown')` — the ORIGINAL symptom, at the same frame |
| one `await readSystemMessage(...)` call site | `coincidentalPrompt.includes is not a function`                                                      |

The first is the exact failure this item started from, which is what establishes the diagnosis. The
second shows the call sites are load-bearing too, and that they fail with a DIFFERENT message —
worth recording, because the two shapes look unrelated and lead a reader to two different places.

## Progress

### 2026-08-20

Found while diagnosing a red `quality` check on the PEER-004 pull request. The first reading blamed
that branch — the check was red on its head commit, and it was green before. Reproducing on a
detached clean `origin/develop` is what corrected it: CI tests the PR MERGED INTO its base, so a
branch cut before ARCH-035 shows the base's defect on its own head sha and looks like the culprit.
