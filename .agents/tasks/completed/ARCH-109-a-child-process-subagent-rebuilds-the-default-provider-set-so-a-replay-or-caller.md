---
title: 'ARCH-109: a child-process subagent rebuilds the default provider set, so a replay or caller-supplied provider does not cross the boundary'
issue: https://github.com/woojubb/robota/issues/2044
status: done
created: 2026-08-25
completed: 2026-08-25
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

Delivered as `360695df1` (PR #2297). The two failing sets, as the runs reported them:

```
Test Files  4 failed | 51 passed (55)
      Tests  20 failed | 417 passed (437)
AssertionError: expected [Function] to throw error including 'process.exit:0'
  but got 'robota cannot start: this session composed caller-supplied providerDefinitions…'
  ❯ packages/agent-cli/src/__tests__/cli-exit-codes.test.ts:103

Test Files  1 failed | 54 passed (55)
      Tests  4 failed | 431 passed (435)
AssertionError: expected 'Subagents will run in-process: this s…' to be ''
  ❯ packages/agent-cli/src/__tests__/cli-update-check.test.ts:126
```

The second block is the narrower version — a warning rather than a throw — and
`packages/agent-cli/src/__tests__/cli-update-check.test.ts:126` is `expect(stderr.mock.calls.join('')).toBe('')`,
which is the print/JSON output contract rather than a test being fussy.

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

## What this Task did NOT deliver

Recorded here as well as on the issue, because a `done` record beside an open issue invites the
reading that the issue is stale. It is not: issue #2044 stays open with three of its four acceptance
criteria unmet, and the comparison is in a comment there naming `360695df1`.

- **A self-fork test using a custom provider across parent and child.** The seam is a parameter now,
  but robota's worker entry still calls the recipe with no arguments and exposes no paired worker
  entry, so there is no supported way to arrange the crossing yet.
- **An end-to-end replay assertion.** The mechanism is asserted at the selector — zero calls to the
  child-runner builder, which is what would read the key — but no test drives a replay run through
  the subagent tool and observes no network call.
- **Startup refusal.** Deliberately rejected on evidence; see the correction above. That rejection is
  a proposal back to the issue's author, and the issue is where it is argued.

This Task is `done` for what it set out to change. The issue is the thing that is not finished.

## User Execution Test Scenarios

Both were executed against the BUILT binary (`packages/agent-cli/bin/robota.cjs`) on 2026-08-25, in a
throwaway `$HOME` with a minimal environment so no real key or token could reach the run.

### Scenario 1 — a replay session does not reach the live provider

`robota --session-log <log> -p '<prompt>'`, with a profile whose key is deliberately invalid.

```
=== exit code ===
0
=== stdout ===
two
=== stderr ===
Subagents will run in-process: this session composed a replay provider (--session-log), which a child
process cannot rebuild, so child-process subagents would run on a different provider than this one.
Process isolation is off for subagents; the provider is shared.
=== observations ===
in-process notice present: true
authentication error present: false
```

**Control, and it is what makes this evidence rather than decoration.** The same setup with
`--session-log` removed:

```
=== stderr ===
[ERROR] [ExecutionService] [ROUND] Provider call failed
401 {"type":"error","error":{"type":"authentication_error","message":"API key is invalid."}}
=== observations ===
in-process notice present: false
authentication error present: true
```

So the key really is invalid and a live call really does happen on that path — which is what makes the
replay run's _absence_ of an authentication error mean "no live call" instead of "nothing tried".
The notice appears only for a replay session.

### Scenario 1's second half could NOT be executed, and the reason is measured

The scenario as written wanted the _subagent_ observed making no live call. **The subagent cannot be
reached from this surface.** A recorded tool call has no observable effect under `--session-log -p`:

| Round-0 tool call                                        | stdout |
| -------------------------------------------------------- | ------ |
| `Agent` (the subagent tool)                              | `two`  |
| `NoSuchToolARCH109` (a name that does not exist)         | `two`  |
| `Read` against a file containing `ARCH109-PROBE-CONTENT` | `two`  |

`two` is round 1's recorded content. A tool name that cannot resolve produces output identical to one
that can, and the probe file's content never appears; `--permission-mode bypassPermissions` changed
nothing. Filed as issue #2302.

**Recorded as a blocked half rather than a passed gate.** Had the first table been written without the
`NoSuchToolARCH109` and `Read` rows, this scenario would have read as passing while proving nothing
about the subagent — the exact shape the fix itself is about, one level up.

### Scenario 2 — an embedded product with its own providers keeps working, and says nothing

Public SDK usage: `startCli({ providerDefinitions: [...] })` in print mode.

```
=== exit code ===
0
=== stdout ===
embedded provider answered
=== stderr ===

=== observations ===
stderr empty: true
startup refusal present: false
```

**This is a regression guard, not a demonstration.** It would also have passed before this change —
that is the point, since the first design broke it. It proves the fallback did not cost the embedding
path, and it is recorded as a scenario because it is what rejected the first design.

One thing learned by running it rather than reasoning about it: a provider's response `timestamp` must
be a `Date` instance, not an ISO string — `execution-event-emitter-high-level.ts` checks
`instanceof Date`, and an ISO string fails with `[EXECUTION] assistant response timestamp is required`.
