---
title: 'CLI-083: the org policy loader has no caller, so four enforcement sites are unreachable in the shipped product'
issue: https://github.com/woojubb/robota/issues/2287
status: todo
created: 2026-08-24
priority: medium
urgency: soon
area: packages/agent-cli, packages/agent-command, packages/agent-product
depends_on: []
---

# CLI-083: the org policy loader has no caller, so four enforcement sites are unreachable in the shipped product

## Objective

`~/.robota/org-policy.json` is never read by the shipped product. `loadOrgPolicy()` is the only
function that reads it and has **zero callers** — so four enforcement sites that are implemented and
correct are unreachable, and an operator who writes that file gets nothing and no indication.

## It is a regression, not a feature that was never wired

```
2026-05-23  48ebec353  feat(cli-026): enterprise org-policy enforcement layer (#581)
            + const orgPolicy = loadOrgPolicy();
            + createDefaultCommandModules({ …, orgPolicy: orgPolicy ?? undefined })

2026-05-25  92596bc6f  refactor: ARCH-002 slim agent-cli + CLI business logic extraction (#607)
            -  loadOrgPolicy,
            -  const orgPolicy = loadOrgPolicy();
```

Two days alive; dead since. `git log --all -S "loadOrgPolicy()"` returns exactly those two commits,
so that is the entire history of the call site. Removed from `agent-cli/src/startup/command-setup.ts`,
which still exists and still calls `createDefaultCommandModules` at :160.

**The refactor went further than dropping the call: `createDefaultCommandModules` no longer accepts
`orgPolicy` at all.** Its signature destructures six fields and that is not one of them. Meanwhile
`provider-command-profile-operations.ts:40` still reads `const { orgPolicy } = options` and enforces
on it, and `IProviderCommandModuleOptions.orgPolicy` is still declared.

**The enforcement kept its input and the pipe that fed it was removed one segment at a time, and the
type system was satisfied throughout because the field is optional.** An optional parameter deleted
from a producer is invisible to a consumer that reads absence as "no policy configured".

## Why nothing went red

The only test, `agent-command/src/provider/__tests__/org-policy.test.ts`, constructs a policy object
and passes it in. That is a correct test of enforcement, and it is exactly why this was invisible:
**coverage of the enforcement reads as coverage of the feature**, while the step that would ever
produce a non-null policy is untested because it does not exist.

The precedent is written in one of the files that has the defect. `serve-mode.ts`, immediately above
`buildServeSessionOptions`:

> a field can be declared on the projection, forwarded by two shells and dropped by the third, and
> nothing would have said so — `buildAppendSystemPrompt` had exactly one caller for that whole time.
> **A test of the helper is green in that state; a test of this is not.**

Someone met this at this seam for a different field, wrote down the diagnosis and the test strategy,
and `orgPolicy` was never added. **A lesson recorded that did not generalise to the next field is a
different failure from one never learned**, and it decides the test shape here without further argument.

## What CLI-026's completion record says

Its delivered list has four claims. **Three are true — the enforcement code is all real. The two that
would ever make it run are false:** nothing calls `loadOrgPolicy()`, and there is no startup
enforcement in `cli.ts` (`git grep allowedProviders -- 'packages/agent-cli/src/**'` matches nothing).

**At the moment CLI-026 closed the record was accurate.** It became false two days later and nothing
re-checked it. A completion record is a claim about a moment, and nothing re-derives one after a
refactor lands on the same code. That is filed separately; it is not this item.

## Plan

- [ ] TC-01 — `createDefaultCommandModules` accepts `orgPolicy` again and forwards it to the provider
      command module, so `allowedProviders` and `requireApiKeyFromEnv` are reachable.
- [ ] TC-02 — `buildServeSessionOptions` carries `orgPolicy` into `TInteractiveSessionOptions`.
- [ ] TC-03 — `buildRuntimeOptions` (the composition kernel) carries it too.
- [ ] TC-04 — `command-setup.ts` calls `loadOrgPolicy()` and passes the result.
- [ ] TC-05 — a session built through a real projection with a real `org-policy.json` on disk blocks
      a `blockedCommands` entry. Not a policy object handed to the session.
- [ ] TC-06 — MUTANT: wire ONE projection only; the other projection's test must go RED. A test that
      covers both leaves a half-wiring green, which reads as "the policy is loaded now" — the same
      shape as the hand-fed test that hid this.
- [ ] TC-07 — MUTANT: remove the `loadOrgPolicy()` call while leaving the parameter chain intact; the
      end-to-end case must go RED. The chain being present is not the chain being fed.
- [ ] TC-08 — `run-all-scans` green on a clean tree; `pnpm lint` by EXIT CODE.

## Not in scope

`org-policy-loader.ts` fails open on a malformed policy (`catch { return null }`,
`allow-fallback: malformed org-policy.json must not crash CLI startup`). Real, and **unobservable
until this lands** — hardening a function with no callers cannot be shown to work. It follows this,
separately, so the fix does not ride in on this item's evidence.

## Test Plan

Tests live beside each projection rather than in one place, because the defect is a field present at
one projection and absent at another — a single test over a shared helper is green in exactly that
state. The end-to-end case writes a real `org-policy.json` and drives a real entry point.

Gate commands: `pnpm build`, `pnpm typecheck`, the affected package suites,
`node scripts/harness/run-all-scans.mjs`, and `pnpm lint` read by exit code.
