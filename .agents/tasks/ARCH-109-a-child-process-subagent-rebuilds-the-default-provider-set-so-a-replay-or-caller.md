---
title: 'ARCH-109: a child-process subagent rebuilds the default provider set, so a replay or caller-supplied provider does not cross the boundary'
issue: https://github.com/woojubb/robota/issues/2044
status: in-progress
created: 2026-08-25
priority: critical
urgency: now
area: packages/agent-cli, packages/agent-subagent-runner
depends_on: []
---

# ARCH-109: a child-process subagent rebuilds the default provider set, so a replay or caller-supplied provider does not cross the boundary

Registered as GitHub issue https://github.com/woojubb/robota/issues/2044.

## The defect, re-measured at the current revision

The parent resolves a provider composition that the child never sees, and the child rebuilds a
different one without saying so.

| Where                                                           | What it does                                                                                                                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-cli/src/cli.ts`                                 | `buildCommandSetup` returns `providerDefinitions`; the product may additionally receive `provider: loadReplayProvider(args.sessionLog)`                        |
| `packages/agent-cli/src/cli.ts`                                 | `createRobotaChildProcessSubagentRunner({ providerConfig })` — receives the resolved **settings**, never the definition set and never the replay provider      |
| `packages/agent-cli/src/product/robota-subagent-composition.ts` | `createRobotaSubagentComposition()` returns `providerDefinitions: robotaProviderDefinitions()`, which is `createDefaultProviderDefinitions()`, unconditionally |
| `packages/agent-cli/src/bin.ts`                                 | the worker entry calls `createRobotaSubagentComposition()` **with no arguments**                                                                               |

Two consequences, both reachable today:

**1. A `--session-log` replay parent spawns children that call the live provider with a real key.**
The child runner is constructed from `providerSettings` **before** the replay override is applied to
the product, and `IProviderDefinitionConfig` carries `apiKey`. So the parent replays deterministically
while its subagents make live calls. The comment three lines above the override states the opposite —
"Provider settings/model still come from the configured profile (no key is ever used)" — which is true
of the parent and false of the child.

**2. A `startCli({ providerDefinitions })` caller gets a parent that resolves and a child that does
not.** The child rebuilds the default set, so a name that resolves in the parent is absent in the
child, or — worse than an error — resolves to a _different_ implementation that happens to share the
name.

## Why this is not fixed by serializing the recipe

`IProviderDefinition` carries `createProvider` and `probeProfile`, both **function-valued**. The set
cannot cross a process boundary as data. Any fix that says "send the parent's definitions to the
child" is unimplementable, and stating that first is what rules out the issue's option 1 as written.

## The seam already exists, and it already names this case

`assertChildProcessSubagentsCanReproduce` refuses at composition time when the parent composed a
capability the child cannot rebuild. Its docblock states the parallel outright — that
`ISubagentWorkerComposition.sandboxFactories` is "the same shape, and the same reason, as
`providerDefinitions`". The guard is right; it is simply never asked the provider question. Its input
is `IRobotaPackContext`, a tools context, which has no provider dimension to read.

So the direction is not a new mechanism. It is: ask the existing guard about providers, and give the
child recipe the same injection point the pack factory already has.

## Direction, and the correction the evidence forced

The first implementation **refused at composition time**, matching the capability guard beside it. It
was wrong, and the way it was wrong is the useful part of this record.

Twenty existing tests drive the CLI through `startCli({ providerDefinitions })`. That is not an abuse
of the entry point — it is the supported way to embed the product with your own providers — and none
of those sessions spawn a subagent at all. A composition-time throw was a **false positive against
working software**, and the count made that unarguable rather than a matter of taste.

Then four more tests failed on a narrower version: they assert an empty stderr for print and JSON
runs, where stderr is part of the output contract. So even a _warning_ on every embedded startup was
wrong.

What both measurements say is the same thing: a caller-supplied definition set is the normal path,
not an anomaly. The defect was never that the caller composed providers — it is that the CHILD
resolves a different provider than the parent. So:

1. `createRobotaSubagentComposition` takes its provider definitions as a parameter, defaulted to the
   current value — the shape `createPacks` already has, for the reason it already documents. The
   seam it fills existed: `ISubagentWorkerComposition.providerDefinitions` is documented as carrying
   definitions rather than a constructed provider precisely so "a custom provider type resolves
   instead of throwing `Unknown provider`". Robota's own worker entry pinned it to the default set,
   so the seam was present and unused.
2. `selectRobotaSubagentRunner` **selects rather than refuses**: a composition a child cannot rebuild
   runs its subagents in-process, where they share the parent's provider. The defect is removed, not
   reported, and every legitimate caller keeps working. What is given up is process isolation for
   subagents.
3. `buildChildProcess` is a thunk, so on the fallback branch the child runner is never constructed —
   and constructing it is what reads `providerConfig`, which carries `apiKey`. "No live config was
   assembled" is a stronger property than "the returned runner is the in-process one", and it is the
   one the test holds.
4. The notice is written for a composition the **operator** caused (`--session-log`, which a person
   typed and which changes what they observe) and not for one an embedding **program** made, which
   it cannot act on today and which would break the print/JSON stderr contract.

The capability guard above still throws, and the asymmetry is deliberate: an unreproducible sandbox
is a containment property, where the safe direction is to stop. An unreproducible provider has a
correct fallback, and stopping would be the unsafe direction for the user's session.

## Test Plan

- `nonReproducibleProviderComposition` names each shape and stays silent on the reproducible one.
- The fallback selects the in-process runner **without building** the child runner — asserted as a
  zero call count, not as the identity of the returned value.
- The ordinary run still builds the child runner and writes nothing. Without this control, a selector
  that returned the in-process runner unconditionally would satisfy every other test and quietly
  remove process isolation from every session.
- The child recipe carries the definitions it is given, asserted by **identity**; a name match passes
  for the default set too and so cannot fail on the defect it names.
- Falsification, three arms, each verified to have applied before its verdict was read:

  | Arm | Mutation                                                             | Result               |
  | --- | -------------------------------------------------------------------- | -------------------- |
  | A   | the selector ignores reproduction and always builds the child runner | 2 failed / 19 passed |
  | B   | the predicate never reports a replay provider                        | 2 failed / 19 passed |
  | C   | the child recipe pins the default set again                          | 1 failed / 20 passed |
  | —   | treatment                                                            | 21 passed            |

- Package suite: 435 passed / 55 files.

## User Execution Test Scenarios

**Scenario 1 — a replay run makes no live call from a subagent.**

- Prerequisite: a session log recorded from a run whose transcript invokes the subagent tool, and a
  configured provider profile whose key is invalid (so any live call fails loudly rather than
  silently succeeding and billing).
- Steps: `robota --session-log <path> -p "<the recorded prompt>"`
- Expected: the run completes from the log; stderr carries the line beginning
  `Subagents will run in-process:`; no authentication error appears, because no live call is made.
- Before this change the same run produced a provider authentication error from the child, or — with
  a valid key — a real billed call.
- Evidence: to be captured on the implemented build.

**Scenario 2 — an embedded product with its own providers keeps working, quietly.**

- Steps: run any existing `startCli({ providerDefinitions })` embedding in print mode.
- Expected: stdout unchanged and **stderr empty**. This is the scenario that rejected the first
  design, so it is recorded as a scenario rather than only as a test.
- Evidence: to be captured on the implemented build.
