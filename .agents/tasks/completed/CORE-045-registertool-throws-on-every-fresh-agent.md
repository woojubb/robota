---
title: 'CORE-045: `Robota.registerTool()` throws on every freshly constructed agent, because the tool registry it writes to is only initialized by the first run — so the public API for adding a tool after construction cannot be called before one, and nothing in the repository calls it'
status: done
created: 2026-08-16
completed: 2026-08-16
priority: high
urgency: soon
area: packages/agent-core
depends_on: []
---

# CORE-045: the post-construction tool API is unreachable

Found while writing the CORE-042 parity suite (2026-08-16), which needed it and could not use it.

## Problem

`Robota.registerTool(tool)` (`packages/agent-core/src/core/robota.ts:323`) delegates to
`RobotaConfigManager.registerTool`, whose first statement is
`tools.hasTool(tool.schema.name)` (`robota-config-manager.ts:278`). `Tools` extends `AbstractManager`,
and `hasTool` opens with `ensureInitialized()` (`managers/tool-manager.ts:148-149`), which throws
while `initialized` is false.

`new Tools()` happens in the `Robota` constructor (`robota.ts:106`), but `initialize()` is awaited
only inside `ensureFullyInitialized()`, which the entry points call — `run()`, `runStream()` and the
other public methods. So the ordering is:

```ts
const robota = new Robota(config);
robota.registerTool(new EchoTool()); // throws: "Tools is not initialized"
```

and the only way to reach a working `registerTool` is to run a turn first, which is precisely the
situation the method exists to avoid.

**Measured 2026-08-16** in `packages/agent-core/src/core/__tests__/entry-point-parity.test.ts`: the
suite was first written with `robota.registerTool(...)` and every such case failed with
`Error: Tools is not initialized`. The suite now registers tools through `config.tools`, which is why
this is filed rather than worked around silently — the workaround is in the tests, and the defect is
in the product.

## Why it survived

**Nothing calls it.** A repository-wide search for `.registerTool(` finds the declaration, the
config-manager delegate, and no caller at all — no test, no example, no app. `unregisterTool` is in
the same position. A public method with zero callers has no way to be found broken, which is the same
mechanism that let the streaming turn diverge for six capabilities before CORE-042.

Note the asymmetry that hides it: `config.tools` works, because the constructor path registers those
during initialization. So the feature appears to work for everyone who declares tools up front, and
fails only for the dynamic case.

## Direction

Two shapes, and the choice is a real one rather than a detail:

- **Make the registry usable before the first run.** `Tools` has an async `initialize()` because
  `AbstractManager` defines one, but `doInitialize` may well have nothing asynchronous to do — if so,
  the registry can be constructed ready and `ensureInitialized` stops being reachable for it.
- **Or make `registerTool` await initialization**, which changes its signature to
  `Promise<void>` and makes the public API honest about the fact that an agent is not fully
  constructed until it has initialized.

The first is preferable, and **it is already settled by reading**: `Tools.doInitialize`
(`managers/tool-manager.ts:34-36`) does nothing but emit a debug log. There is no asynchronous work to
wait for, so the `initialized` flag guards nothing and a registry that must be initialized before it
can answer `hasTool` is a lifecycle nobody asked for. This is recorded so the item does not re-derive
it; the remaining work is the change, its red-first test, and the sweep below.

Whichever is taken, `unregisterTool` and any other `ensureInitialized`-guarded public surface reached
directly off the constructor must be checked in the same pass — this is a class of defect, and fixing
the one method that happened to be needed is the fix-it-where-it-surfaced failure mode.

## Test Plan

- Red first: `new Robota(config).registerTool(tool)` on a freshly constructed agent, with no prior
  run, succeeds — it throws today.
- The registered tool is then offered to the model on the next turn, asserted through
  `IChatOptions.tools` (the parity suite's tool-list case is the template).
- `unregisterTool` on a fresh agent, same shape.
- An enumeration test over `Robota`'s public methods that reach an `ensureInitialized`-guarded
  manager, so a future method cannot join this class unnoticed.

## User Execution Test Scenarios

**Applies** — `registerTool` is a public export of `@robota-sdk/agent-core` and this is exactly what a
user calling it experiences.

**No API key, no network.** Credential probe recorded 2026-08-16 in CORE-042 and unchanged since:
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY` and `BYTEDANCE_API_KEY` all
unset, no `.env` present. The scenario needs none: the provider is written against
`AbstractAIProvider`, the same public extension point an integrator uses, and it records what it was
offered.

**Invocation.** From `scratch/`:
`node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-045-s1.ts`.

### Scenario 1 — add a tool to an agent you just built

- Surface: `Robota`, `AbstractTool`, `AbstractAIProvider` — public exports only.
- Expected observable result: `SCENARIO 1 PASS`, `EXIT:0` — `registerTool` is accepted on an agent
  that has never run, the tool then reaches the model, `unregisterTool` works the same way, and a
  destroyed agent refuses with a message that says it was disposed rather than never initialized.
- Evidence: executed 2026-08-16 against the completed implementation; **EXIT:0**. Full output:

```text
registerTool on a fresh agent: accepted
tools offered to the model: ["get_weather"]
unregisterTool: accepted
registerTool after destroy: Tools was disposed — re-initialize it before use, or build a new one
PASS registerTool works on an agent that has never run
PASS the run then succeeds
PASS the registered tool reached the model
PASS unregisterTool works too
PASS a destroyed agent refuses
PASS and says it was disposed, not that it was never initialized
SCENARIO 1 PASS
```

Behaviour pinned in the repository by
`packages/agent-core/src/core/__tests__/fresh-agent-api.test.ts` (`scratch/src` is gitignored, so
the block below is this script's durable home).

```ts
// scratch/src/core-045-s1.ts
/**
 * CORE-045 Scenario 1 — adding a tool to an agent you just built.
 *
 * `Robota.registerTool()` is the public way to give an agent a tool after construction. It threw
 * `Tools is not initialized` on every freshly constructed agent, because the registry it writes to
 * was only initialized by the first run — so the method existed for a moment that never arrived.
 * Nothing in the repository called it, which is how it stayed broken.
 *
 * Written against the public surface only: `Robota`, `AbstractTool`, `AbstractAIProvider`. No API
 * key, no network — the scripted provider is a normal `IAIProvider` implementation, the same
 * extension point a third-party integrator writes.
 */
import { AbstractAIProvider, AbstractTool, Robota } from '@robota-sdk/agent-core';

import type {
  IChatOptions,
  IToolResult,
  IToolSchema,
  TToolParameters,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

class RecordingProvider extends AbstractAIProvider {
  override readonly name = 'recording-provider';
  override readonly version = '1.0.0';
  toolsOffered: string[][] = [];

  override async chat(
    _messages: TUniversalMessage[],
    options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    this.toolsOffered.push((options?.tools ?? []).map((t) => t.name));
    return {
      id: 'r1',
      role: 'assistant',
      content: 'noted',
      state: 'complete' as const,
      timestamp: new Date(),
    };
  }
}

class WeatherTool extends AbstractTool {
  override get schema(): IToolSchema {
    return {
      name: 'get_weather',
      description: 'Get the weather for a city',
      parameters: { type: 'object' as const, properties: { city: { type: 'string' } } },
    };
  }

  protected override async executeImpl(_parameters: TToolParameters): Promise<IToolResult> {
    return { success: true, data: { tempC: 21 } };
  }
}

async function main(): Promise<void> {
  const provider = new RecordingProvider();
  const agent = new Robota({
    name: 'Fresh Agent',
    aiProviders: [provider],
    defaultModel: { provider: 'recording-provider', model: 'test-model' },
    logging: { level: 'silent', enabled: false },
  });

  let registerError = '';
  try {
    // The whole scenario: this line, on an agent that has never run.
    agent.registerTool(new WeatherTool());
  } catch (error) {
    registerError = error instanceof Error ? error.message : String(error);
  }
  console.log('registerTool on a fresh agent:', registerError || 'accepted');

  let runError = '';
  try {
    await agent.run('what is the weather?');
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
  }
  console.log('tools offered to the model:', JSON.stringify(provider.toolsOffered[0] ?? null));

  let unregisterError = '';
  try {
    agent.unregisterTool('get_weather');
  } catch (error) {
    unregisterError = error instanceof Error ? error.message : String(error);
  }
  console.log('unregisterTool:', unregisterError || 'accepted');

  await agent.destroy();
  let afterDestroy = '';
  try {
    agent.registerTool(new WeatherTool());
  } catch (error) {
    afterDestroy = error instanceof Error ? error.message : String(error);
  }
  console.log('registerTool after destroy:', afterDestroy || 'accepted (!)');

  const checks: Array<[string, boolean]> = [
    ['registerTool works on an agent that has never run', registerError === ''],
    ['the run then succeeds', runError === ''],
    [
      'the registered tool reached the model',
      (provider.toolsOffered[0] ?? []).includes('get_weather'),
    ],
    ['unregisterTool works too', unregisterError === ''],
    ['a destroyed agent refuses', afterDestroy !== ''],
    ['and says it was disposed, not that it was never initialized', /disposed/.test(afterDestroy)],
  ];

  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
    if (!ok) failed += 1;
  }
  console.log(failed === 0 ? 'SCENARIO 1 PASS' : `SCENARIO 1 FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
```

## Implementation Outcome (2026-08-16)

`AbstractManager` gains an explicit construction-time lifecycle declaration. `Tools` and `AIProviders`
pass `readyOnConstruction: true`, because their `doInitialize` emits a debug log and nothing else —
there was no asynchronous state for a caller to race, so the refusal was pure obstruction.
`registerTool`, `unregisterTool` and `AIProviders`' whole surface now work from construction.

**Two things the sweep found that the item had not:**

- **`swapDefaultProvider` fails for a SECOND reason.** Its first statement reached
  `AIProviders is not initialized`, which is fixed. Its second is `configManager.setModel`, which
  refuses on the agent-level `isFullyInitialized` flag — and that flag guards genuinely asynchronous
  work with no public entry point to reach it (`initialize()` is `protected`). Filed as
  **[CORE-047](CORE-047-model-config-api-unreachable-without-a-run.md)**, because the fix is a design
  choice rather than a defect with one right answer. `fresh-agent-api.test.ts` pins the two causes
  apart and names the exception, so the enumeration stays honest instead of quietly omitting them.
- **`destroy()` never disposed these managers.** The CORE-022 disposal chain reached modules,
  plugins, the module registry and the event emitter, but not the tool registry or the provider map —
  so a destroyed agent still held them and still ACCEPTED `registerTool`. Absorbed here rather than
  filed, because this change's own claim (that the lifecycle flag marks teardown) was false without
  it. `destroyAgent` now disposes them through the same best-effort `step()` every other component
  uses.

**The guard's message was also wrong in a way that cost time.** "not initialized" was reported for
both refusing states, so a use-after-dispose read as a missing `await`. The two are now reported
separately, and disposal remains reversible by an explicit `initialize()` — the contract this class
always had, since both hooks are documented idempotent.

**Tests that pinned the defect.** `ai-provider-manager.test.ts` carried eleven cases asserting that
every method throws `AIProviders is not initialized` before initialization. That was the defect
written down as a contract; they are replaced by cases asserting the seam that actually matters —
usable from construction, refusing after disposal, usable again after an explicit re-initialize.

### Verification

- `packages/agent-core`: 1032 tests pass; `pnpm harness:verify --scope packages/agent-core` green
  including the recorded offline scenario.
- Every other workspace package's suite passes (`dag-adapters-sqlite` and `dag-worker` excluded — they
  fail locally on a missing `better-sqlite3` native binding, an environment fault outside this
  change's file set).
- Red-proof: reverting both `readyOnConstruction` declarations turns 4 of the 5 cases in
  `fresh-agent-api.test.ts` red, including the two the item is named after.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-16

**Status upgrade:** in-progress → done

- The scenario was executed by the agent against the completed implementation, `EXIT:0`, with its
  full output recorded above.
- The observed result matched the expected observable result.
- Evidence references durable repository artifacts:
  `packages/agent-core/src/core/__tests__/fresh-agent-api.test.ts` and the script block above.
- No engineering verification is cited as user-execution evidence — the suites are under
  _Verification_.
- No capability-absence claim is made; the credential probe is recorded and no credential was
  needed.
