---
title: 'CORE-047: `getModel()` and `setModel()` refuse until the agent is fully initialized, and the only thing that initializes an agent is running it — so the model-configuration API cannot be reached before the first turn, and `initialize()` is protected rather than public'
status: todo
created: 2026-08-16
priority: medium
urgency: soon
area: packages/agent-core
depends_on: []
---

# CORE-047: the model API is unreachable before the first run

Found while sweeping the fresh-agent surface for
[CORE-045](completed/CORE-045-registertool-throws-on-every-fresh-agent.md). CORE-045 fixed the methods whose
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

and there is **no public way to make it ready** — `initialize()` is `protected override`. The only
route is to run a turn, which is to say: you must ask the model a question before you may ask which
model you are using.

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

## Direction

The decision is which of these the agent means, and it is a real design choice rather than a defect
with one right answer:

- **Make readiness reachable.** Expose the initializer publicly (`await agent.ready()` /
  `await agent.initialize()`), so the error message names an action the caller can take. Smallest
  change, and it leaves the existing guard meaningful.
- **Or make these methods not need it.** `setModel` writes to `config.defaultModel`, which the
  constructor already populated from `IAgentConfig`; `getModel` reads it back. Neither obviously
  needs the modules or the agent factory. If that holds, the guard is over-broad and the methods can
  work from construction like the CORE-045 pair.
- **Or make the constructor's contract explicit** — an agent is not usable until awaited, with a
  static async factory (`await Robota.create(config)`) and a constructor that is not public.

Whichever is chosen, the error message must stop instructing the caller to reach a state the API
does not expose.

## Test Plan

- Red first: `new Robota(config).getModel()` returns the configured model without a prior run.
- The same for `setModel` and `swapDefaultProvider`.
- `packages/agent-core/src/core/__tests__/fresh-agent-api.test.ts` enumerates the synchronous public
  surface and currently records these three as blocked by this item; that enumeration is the place to
  flip them, so the fix cannot land without the record being updated.
- Whatever guard survives must still refuse on a **destroyed** agent, with a message that says
  "destroyed" rather than "not initialized".

## User Execution Test Scenarios

**Applies** — `getModel`, `setModel` and `swapDefaultProvider` are public exports of
`@robota-sdk/agent-core` and this is what a caller reaching for them experiences. Author the scenario
when the item is picked up: construct an agent from a scripted provider, read its model, swap the
provider, and observe the next turn go to the replacement. No API key or network needed.
