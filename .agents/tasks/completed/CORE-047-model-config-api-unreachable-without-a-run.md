---
title: 'CORE-047: `getModel()` and `setModel()` refuse until the agent is fully initialized, and the only thing that initializes an agent is running it — so the model-configuration API cannot be reached before the first turn, and `initialize()` is protected rather than public'
status: done
created: 2026-08-16
completed: 2026-08-17
priority: medium
urgency: soon
area: packages/agent-core
depends_on: []
---

# CORE-047: the model API is unreachable before the first run

Found while sweeping the fresh-agent surface for
[CORE-045](CORE-045-registertool-throws-on-every-fresh-agent.md). CORE-045 fixed the methods whose
guard protected nothing; these are the ones whose guard protects something real, and are therefore a
different problem with a different answer.

## Problem

`RobotaConfigManager.setModel` (`robota-config-manager.ts:189`) and `getModel` (`:232`) both refuse
unless `isReady()`, which is bound to `Robota.isFullyInitialized`. That flag is set only by
`ensureFullyInitialized()`, and the only callers of it are `run()`, `runStream()` and the protected
`initialize()` override (`robota.ts:150,170,201,383-384`).

So on a freshly constructed agent:

```ts
const agent = new Robota(config);
agent.getModel(); // ConfigurationError: Agent must be fully initialized before getting model configuration
```

and the only obvious route is to run a turn, which is to say: you must ask the model a question
before you may ask which model you are using.

> **Correction to this item's own premise, 2026-08-17.** It said "there is **no public way to make it
> ready** — `initialize()` is `protected override`". That is **false, and was false when this was
> written**: `Robota.ensureReady()` is public and does exactly this, and it landed 2026-06-14 in
> `68671e2b7`. The sweep looked at `initialize()` and stopped. Measured through the public API:
> `await new Robota(config).ensureReady()` makes all three methods work. So the first Direction
> option below ("make readiness reachable") was already delivered and is not what this item needed.

`swapDefaultProvider` (`robota.ts:328-331`) is in the same position, because its second statement is
`configManager.setModel`.

**Measured 2026-08-16** through the public API:
`new Robota(config).swapDefaultProvider(p, 'm')` → `ConfigurationError: Agent must be fully
initialized before changing model configuration`.

## Why this is not CORE-045

CORE-045 was about a flag that guarded nothing: `Tools.doInitialize` and `AIProviders.doInitialize`
only emit a debug log, so there was no asynchronous state a caller could race and the refusal was
pure obstruction. Those managers now declare `readyOnConstruction`.

Here the agent genuinely does asynchronous work — `doAsyncInit` initializes managers, the agent
factory, plugins and modules. Refusing to reconfigure a half-built agent is defensible. The defect is
that the contract is unstateable by a caller: there is no public entry point, and the error message
tells the user to do something the API does not let them do.

## Direction — decided, with the evidence

Three options were posed. The measurement settles it against the first and the third, and **for the
second**:

- ~~**Make readiness reachable.**~~ Already delivered — `ensureReady()` (see the correction above).
  Nothing to build, and it does not answer the question, because it leaves standing a guard that
  turns out to protect nothing.
- **Make these methods not need it — CHOSEN.** The premise held, and more strongly than the item
  guessed. `setModel`/`getModel` need two things: the provider registry, and the current
  `(provider, model)` pair. `robota-initializer.ts` established both, but **both steps are
  synchronous** and read only `config.aiProviders` / `config.defaultModel` — config that
  `validateAgentConfig` has already accepted in the constructor. They sat in an async function
  purely because they were written next to work that genuinely is async (modules, plugins, the
  execution service). `AIProviders` is `readyOnConstruction: true` (CORE-045), so `addProvider` and
  `setCurrentProvider` are callable from the constructor with no ordering hazard.

  Both steps moved into the constructor as `applyConstructedModelConfig`, and were REMOVED from the
  async initializer rather than duplicated — repeating them there would revert a `setModel()` made
  before the first run back to `config.defaultModel` when the run initializes. With the state
  established at construction, the `isReady()` guard on the two methods protects nothing and is
  deleted. This is CORE-045's outcome reached for a different reason: there the guarded work did not
  exist, here it existed but was in the wrong place.

- ~~**Make the constructor's contract explicit** (async factory, non-public constructor).~~ Rejected.
  It is the largest change of the three, it breaks every construction site in the workspace and every
  published example, and it would be justified only if an agent genuinely could not answer anything
  before async work completed. It can — that is what this item established.

**The error-message requirement is met, by removal rather than rewording.** No message now instructs
a caller to reach a state the API does not expose. What survives is the destroyed case, which reports
`AIProviders was disposed — re-initialize it before use, or build a new one` (the manager's own
CORE-045 message) instead of the old "must be fully initialized", which is the misdiagnosis the Test
Plan called out.

## Test Plan

`packages/agent-core/src/core/__tests__/model-config-before-first-run.test.ts` — six cases, all six
red against the unfixed code:

```
× getModel() returns the configured model with no prior run
  → Agent must be fully initialized before getting model configuration
× setModel() takes effect with no prior run, and getModel() reads it back
× swapDefaultProvider() registers and selects a replacement with no prior run
× the swapped provider is the one the first turn actually goes to
× an unregistered provider is still rejected, and names what is available
× a DESTROYED agent refuses, and says destroyed rather than "not initialized"
Tests  6 failed (6)
```

Two of those are deliberately not "the guard is gone" assertions, because a change that simply
deleted a guard would pass those:

- **The swapped provider is the one the first turn goes to.** Asserting only that `getModel()`
  reports the new name would pass on a config write that never reached the provider registry.
- **An unregistered provider is still rejected**, naming what is available. Removing the readiness
  guard must not remove the validation behind it.

`packages/agent-core/src/core/__tests__/fresh-agent-api.test.ts` was the place the item said to flip,
and it is flipped: the three methods moved out of the `blockedByCore047` named-exception list and
into the enumerated surface, and the `swapDefaultProvider` case that asserted
`toThrow(/must be fully initialized/)` now asserts `not.toThrow()`. That enumeration has no named
exceptions left.

Full suites green: `agent-core` 1081 tests, and every consumer of it — `agent-framework` 1359,
`agent-cli` 306, `agent-session` 224, `agent-executor` 104, `agent-subagent-runner` 28.
(`dag-adapters-sqlite` fails locally on a missing `better-sqlite3` native binding — pre-existing and
environmental, issue #1768, unrelated to this change.)

## User Execution Test Scenarios

**Applies** — `getModel`, `setModel` and `swapDefaultProvider` are public members of `Robota`, and
this is exactly what a caller reaching for them experiences. `agent-executable` and provider-free:
the providers are local stubs that record which one was called, so no API key and no network.

### Scenario — configure the model before the first turn, and see the turn go there

**Command:** `cd scratch && node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-047.ts`

**Evidence:** EXIT:0

```
a freshly constructed agent — no run, no ensureReady:
  getModel(): OK -> {"provider":"primary","model":"primary-model","temperature":0.5}
  swapDefaultProvider(replacement): OK
  getModel() again: OK -> {"provider":"replacement","model":"swapped-model","temperature":0.5}
the first turn:
  answer: answered by replacement
  providers actually called: ["replacement"]
after destroy():
  getModel(): THREW -> AIProviders was disposed — re-initialize it before use, or build a new one
PASS a fresh agent can be asked which model it is configured for
PASS and it answers with the configured model, tuning included
PASS a fresh agent can be pointed at a different provider
PASS the change is readable back before any turn runs
PASS tuning survives the swap — it changed WHERE the turn goes, not how the model is asked
PASS and the first turn actually goes to the replacement, not the original
PASS a DESTROYED agent still refuses
PASS and says destroyed rather than misreporting it as "not initialized"
CORE-047 SCENARIO PASS
```

**Red-proof.** Re-run with the three source edits stashed — 7 of 8 fail, and the one that passes
("a destroyed agent still refuses") is the one that was never broken:

```
  swapDefaultProvider(replacement): THREW -> Agent must be fully initialized before changing model configuration
  answer: answered by primary
  providers actually called: ["primary"]
  getModel() [after destroy]: THREW -> Agent must be fully initialized before getting model configuration
CORE-047 SCENARIO FAIL (7)
```

The `providers actually called: ["primary"]` line is the user-visible cost: the swap was refused, so
the turn went to the original provider.
