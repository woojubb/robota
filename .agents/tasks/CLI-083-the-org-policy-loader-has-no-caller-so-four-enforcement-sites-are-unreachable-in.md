---
title: 'CLI-083: the org policy loader has no caller, so four enforcement sites are unreachable in the shipped product'
issue: https://github.com/woojubb/robota/issues/2287
status: blocked
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

- [x] TC-01 — `createDefaultCommandModules` accepts `orgPolicy` again and forwards it to the provider
      command module, so `allowedProviders` and `requireApiKeyFromEnv` are reachable.
- [x] TC-02 — `buildServeSessionOptions` carries `orgPolicy` into `TInteractiveSessionOptions`.
- [x] TC-03 — disposition recorded: the product/TUI/headless projection mechanism was not patched
      field-by-field here; it is contained under ARCH-110 / issue #2295, with the known gaps marked
      at their projection sites.
- [x] TC-04 — `command-setup.ts` calls `loadOrgPolicy()` and passes the result.
- [x] TC-05 — the built CLI, running in a real PTY with a real `org-policy.json` on disk, rejects a
      provider switch forbidden by `allowedProviders`. The originally planned TUI `blockedCommands`
      assertion crosses the contained channel→session gap and therefore belongs to ARCH-110 rather
      than being falsely claimed here.
- [x] TC-06 — MUTANT: wire ONE projection only; the other projection's test must go RED. A test that
      covers both leaves a half-wiring green, which reads as "the policy is loaded now" — the same
      shape as the hand-fed test that hid this.
- [x] TC-07 — MUTANT: remove the `loadOrgPolicy()` call while leaving the parameter chain intact; the
      end-to-end case must go RED. The chain being present is not the chain being fed.
- [x] TC-08 — `run-all-scans` green on a clean tree; `pnpm lint` by EXIT CODE.

## Implementation and completion disposition

PR #2293 delivered the loader call, provider-module wiring, serve-session projection, and the shell
forwarding up to the default TUI channel. Merge commit
`d39c9e12979d46e9efe40e8ba823f0503c296c78` was independently verified on `origin/develop`;
[issue #2287](https://github.com/woojubb/robota/issues/2287) was closed with that commit.

Review exposed a broader, recurring cause: optional session capabilities are manually projected by
the TUI and headless surfaces. The default TUI channel→session hop and print/goal path still omit
`orgPolicy`. Those are not silently counted as delivered here: the actual omission sites in
`buildTuiSessionOptions` and `HeadlessInteractionChannel` carry `Contained — ARCH-110.`, and the root
work remains open in
[the archived `ARCH-110` migration record](completed/ARCH-110-session-capability-projections-can-silently-drop-optional-fields.md) /
[open implementation issue #2295](https://github.com/woojubb/robota/issues/2295). CLI-083 completes the regression repair
that made the four enforcement sites reachable in the shipped composition; ARCH-110 owns making
every presentation path complete and mechanically preventing the next optional-field drop.

The implementation disposition is not a valid completion disposition. The user-execution scenario
was authored after implementation and after merge, so `DONE-GATE-STAGE-1` returned
`NON-COMPLIANCE` on 2026-08-25 and the `user-execution-scenario` pipeline halted without entering
Stage 2. This item therefore remains nonterminal and blocked even though issue #2287 correctly stays
closed for the shipped product fix; no retrospective gate evidence is being fabricated.

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

## User Execution Test Scenarios

### Scenario: a policy loaded from disk blocks a provider switch in the built TUI

Executability decision: `agent-executable` through the repository's real-PTY driver.

Prerequisites: build the Robota CLI; create an isolated HOME with Anthropic and OpenAI provider
profiles and `.robota/org-policy.json` containing
`{"allowedProviders":["anthropic"],"adminContact":"ops@example.com"}`.

Steps: launch the built `robota --disable-update-check` binary in a real terminal with that HOME,
wait for the TUI prompt, enter `/provider switch openai`, and submit it.

Expected: the TUI reports `Provider "openai" is not allowed by your organization policy` and names
`anthropic` as the allowed provider. No model call or network request occurs.

Cleanup: terminate the TUI and remove the isolated project/HOME directory.

Engineering regression evidence (2026-08-25; not Done Gate Stage 2 evidence):
`pnpm --filter @robota-sdk/agent-transport-tui exec vitest run --config vitest.pty.config.ts src/__tests__/pty/org-policy.ptytest.ts`
ran the built binary in a pseudo-terminal and passed 1/1 in 2.07s. The permanent scenario is
`packages/agent-transport-tui/src/__tests__/pty/org-policy.ptytest.ts`. This scenario was added after
the implementation PR rather than before implementation; the run therefore remains engineering
regression evidence and does not satisfy either done-gate stage. That planning-order violation is
recorded here instead of being rewritten as if the gate had run on time.

Control (2026-08-25; also NOT gate evidence): the run above establishes that the scenario passes,
which on its own does not establish that it could fail. Removing the `loadOrgPolicy()` call from
`command-setup.ts` and rebuilding the CLI turns the same scenario red —

```
× blocks a provider switch forbidden only by the policy loaded from disk
  → PTY waitForSince timeout (15000ms) for
    /Provider "openai" is not allowed by your organization policy/
```

— the refusal message never appears, so the scenario is not byte-identical with and without the
behaviour it names. The call was restored and the green re-verified. This is recorded because a
passing scenario and a discriminating one are different claims, and only the second says anything;
it remains engineering regression evidence and satisfies neither done-gate stage, for the ordering
reason stated above, which no amount of green can change.

### [DONE-GATE-STAGE-1] — 🔴 NON-COMPLIANCE | 2026-08-25

**Status remains:** done
**Violation:** `DONE-GATE-STAGE-1` has no prior gate, but its PLAN-stage ordering was bypassed: merge
commit `d39c9e12979d46e9efe40e8ba823f0503c296c78` delivered the implementation before this scenario
existed, while commit `3a44a5903bfae6cdb5eb60896736be2f31cc62ff` added the scenario afterward and already set the item
to `status: done` under `.agents/tasks/completed/`. The scenario itself also explicitly records that it
was added after the implementation PR. Per the Done Gate absolute rule, completion cannot precede both
done-gate stages, and a retrospective scenario cannot establish the required pre-implementation PLAN
ordering.
**Required action:** Route this process violation through `user-execution-scenario`; do not treat the
retrospective scenario or its engineering test output as a Stage 1 PASS, and do not run Stage 2 as though
PLAN had returned `PLANNED`.
