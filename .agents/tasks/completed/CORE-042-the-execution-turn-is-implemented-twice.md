---
title: 'CORE-042: agent-core declares one execution-turn contract and implements it twice — `executeStream` re-derives store setup, provider resolution, chat options, validation, commit and error classification inline instead of entering a shared turn seam, so every turn capability must be built twice and the forgotten copy fails silently'
status: done
created: 2026-08-16
completed: 2026-08-16
priority: critical
urgency: now
area: packages/agent-core
depends_on: []
---

# CORE-042: the execution turn is implemented twice

Root item filed under [finding-depth.md](../rules/finding-depth.md) for the `DEPTH: FOUNDATIONAL`
verdict on [CORE-036](completed/CORE-036-runstream-never-applies-config-systemmessage.md) (2026-08-16).
Registered as [issue #1748](https://github.com/woojubb/robota/issues/1748); the symptom it was raised
from is [issue #1736](https://github.com/woojubb/robota/issues/1736).
Disposition: **containment** — CORE-036 was a live correctness defect in a published beta and landed
its minimal fix under a label naming this item (`services/execution-stream.ts`, `Contained — CORE-042.`);
the cause is not patched in place and remains this item's work.

## Problem

`agent-core` documents ONE execution engine with two entry points. `Robota.run()` and
`Robota.runStream()` receive an identical `executionConfig`, and the SPEC states turn guarantees
unconditionally — § System Prompt names `initializeConversationStore` as the mechanism, § Cancellation
Contract, the round loop and the required event families make no distinction between the two.

There is no shared turn. The round path composes named steps —
`buildFullExecutionContext` → `resolveProviderAndTools` → `initializeConversationStore` →
`runExecutionLoop`/`executeRound` → `callProviderWithCache` → `finalizeExecution`. `executeStream`
re-derives every one of them inline and owns none, so **no seam exists that a new turn capability
must pass through**. Parity is a convention held by reviewer memory, and its failures are silent by
construction: the model still answers — just without the prompt, the token cap, the plugin, or the
tool.

## Evidence: this is the seventh instance, not the first

Every commit that has ever touched `execution-stream.ts` for behaviour is the identical patch —
"the streaming path dropped X that the round path has; copy X in":

| Commit      | Item            | What the streaming path had dropped                                                                   |
| ----------- | --------------- | ----------------------------------------------------------------------------------------------------- |
| `d2015a40a` | CORE-016        | `maxTokens`/`temperature` — it had "silently dropped **ALL** model options". External report, beta.76 |
| `03a83f3d8` | CORE-017        | `toolChoice`                                                                                          |
| `bda1d4cfa` | CORE-018        | `signal` — "made the public streaming API uncancellable"                                              |
| `8866de037` | CORE-020        | response validation                                                                                   |
| `6f308d102` | BEHAVIOR-005    | token usage on the committed assistant message                                                        |
| `4fc3ec266` | SELFHOST-008 P3 | `ephemeralSystemContext` — landed as a _review SHOULD_, i.e. caught by reviewer memory                |
| —           | **CORE-036**    | `config.systemMessage`. **External report, beta.78** — the second user-facing regression              |

The code carries the scar tissue in its own comments: `execution-stream.ts:107` "mirror the round
path", `:132` "must carry the same model options as the round path", `:259` "parity with the run-path
response validation", `execution-stream-tools.ts:50` "like the round path". `SPEC.md:474`
institutionalises it with a heading — "**runStream path (parity)**" — and `SPEC.md:832` records the
same apology in a table cell. A parity heading in a specification is the contract admitting it has
two implementations.

## Divergences still live, and unfiled

Found while checking whether `config.systemMessage` was the only one. None of these has a task, and
they are enumerated here so a scoping decision cannot silently drop them: **none may be dropped from
this item's scope without being filed as its own task.** They are not filed separately today on
purpose — five tasks each named after one dropped clause would be five items whose correct fix is the
same seam, which is the fix-it-where-it-surfaced failure mode `finding-depth.md` exists to prevent,
and would invite five more copy-in patches.

- **`beforeProviderCall` / `afterProviderCall` never fire on streaming.** They are dispatched only at
  `execution-round.ts:93,185`, so a plugin that inspects or rewrites provider traffic is blind on
  `runStream()`.
- **The tool-list predicate differs.** The round path includes tools when
  `resolved.availableTools.length > 0` (`execution-round-provider.ts:65`); streaming asks
  `config.tools && config.tools.length > 0` (`execution-stream.ts:144`) and then sends
  `tools.getTools()`. Two different questions producing two different tool lists for one agent —
  **measured 2026-08-16 through the public API**: an agent constructed with no `tools` in its config,
  given one via `robota.registerTool()`, offers the model `["echo_tool"]` through `run()` and `[]`
  through `runStream()`. A tool the user registered is invisible to the streaming path.
- **`resolveProviderAndTools`' validation is skipped.** A tool missing a `description` throws on the
  round path and passes on the streaming one.
- **No cache-service lookup**, **no `handleContextCapacityBlock` pre-send guard**, **no
  `isAbortFailure` classification**, and **no `beginAssistant`/commit** — which is why CORE-034's
  `interrupted` state is unreachable on this path.
- **Three independent `IChatOptions` construction sites**: `execution-round-provider.ts:51`,
  `execution-stream.ts:137`, `execution-pipeline.ts:161` — the third already filed as CORE-033 for
  dropping `signal`/`effort`.

## Related open items are further instances, not neighbours

- **CORE-032** (`runStream` is a single-round engine) is the same cause at the loop-control layer,
  where this item is at the turn-preparation layer. Decisively: **CORE-032's own Direction — "route
  `executeStream` through the same round loop as `execute`" — would have prevented CORE-036
  outright.** A finding that an already-filed fix would have prevented is not local to itself.
- **CORE-033** (abnormal-path provider calls are off-contract) is the third `IChatOptions`
  construction site.
- **CORE-034** (interrupted-message annotation is dead code) is unreachable on streaming for this reason.

## Why the repeat is not caught structurally

The **sanctioned** shared test double covers one of the two implementations. `createScriptedProvider`
(`packages/agent-core/src/testing/scripted-provider.ts`, exported from the published `./testing`
subpath) implements `chat()` and records `requests`, but has **no `chatStream`** — so the surface the
repo blesses for exercising a turn cannot drive `runStream()` at all. `createReplayProvider` in the
same module has none either.

Every streaming double in agent-core is therefore **per-file**: `core/robota.test.ts:14-53`
(`TrackingProvider`, which does record both entry points and is the double behind the CORE-016/017/018
parity pairs), plus separate ones in `services/__tests__/ephemeral-system-context.test.ts:78-88`,
`execution-service.test.ts`, `agents/robota.test.ts`, `local-executor.test.ts`,
`agent-factory.test.ts` and `ai-provider-manager.test.ts`. `ReplayProvider`
(`packages/agent-provider-replay/src/replay-provider.ts:73-80`) is a shared streaming double but is
unreachable from agent-core by dependency direction.

**Stated precisely, because the weaker claim is the true one:** streaming is not untestable — the
parity pairs above exist and pass. What is missing is a _shared_ seam for it, so each parity check is
written from scratch by whoever remembers to write it, which is the same reviewer-memory mechanism
that let six copies of this patch be needed and the seventh reach a published beta.

## Direction

The unit of work is **a single turn seam both entry points enter** — not another copied clause.

`executeStream` becomes a second _entry_ into one turn rather than a second implementation of it:
the shared steps (context build, provider + tool resolution, store initialization, chat-option
construction, provider-message derivation, validation, commit, error classification) are owned once,
and streaming supplies only what genuinely differs — chunk delivery and the incremental commit.

**Sequencing.** This overlaps CORE-032 (the round loop) and CORE-033 (the third options site) by
construction, so it is planned with them rather than beside them; doing this one first and then
CORE-032 would re-derive the same seam twice. Whether the three are executed as one work unit or as an
ordered initiative is the first decision the spec-doc must make.

**A prerequisite, not an afterthought:** the shared test double must be able to exercise a streaming
turn, rather than each test file re-writing its own — the state that let this happen.

> **Correction (2026-08-16).** This paragraph previously said the work was reserved because "it widens
> a published `./testing` export, which `backlog-execution.md` § Agent Decision Authority reserves."
> **That ground does not exist here and is withdrawn.** No stable version has been released, the beta
> is not distributed, and the rules forbid keeping legacy or compatibility code (`code-quality.md:50`
> — _"unreleased — no backward-compat constraint"_). That clause reserves a change for the coordination
> cost with a party who cannot be updated; inside this repository there is none. The test to apply is
> **"is there a party who cannot be updated?"**, not "is this exported?".
>
> It is also not a widening: `createScriptedProvider.chat()` currently ignores `options.onTextDelta`,
> which is a clause of the `IAIProvider` contract it claims to implement. Bringing it into conformance
> needs no permission. Recording the `IChatOptions` it was called with IS additive, and is ordinary
> agent-authority work.

## Test Plan

- A table-driven suite that runs the SAME assertions over BOTH entry points, so a future divergence
  fails rather than passing quietly. At minimum: system prompt, model options, `toolChoice`, `signal`,
  `ephemeralSystemContext`, usage metadata, plugin hooks, tool list, and tool-schema validation — the
  six already-patched capabilities plus the ones found unfiled above.
- A test asserting the two paths build the same `IChatOptions` from the same config.
- `createScriptedProvider` gains `chatStream` and records streaming requests; the one-off double in
  `services/__tests__/ephemeral-system-context.test.ts` is retired in favour of it.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies** — this changes observable behaviour of a published SDK entry point (`Robota.runStream()`).
The section covers CORE-042 and CORE-032's Test Plan together, because one change delivers both.

**Surface: public exports, no provider.** `AbstractAIProvider`, `AbstractPlugin`, `AbstractTool`,
`FunctionTool`, `Robota` and `IRunOptions.onExecutionEvent` are all public exports of
`@robota-sdk/agent-core`; a scripted provider written against them is the same extension point a
third-party integrator uses. **No API key, no network, no live service.** Credential probe recorded
2026-08-16: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY` and
`BYTEDANCE_API_KEY` all unset, no `.env` present — so a live surface was neither needed nor available.

**Invocation.** From `scratch/`, either `pnpm run run src/<file>.ts` or
`node ../node_modules/tsx/dist/cli.mjs --conditions=source src/<file>.ts`; both were exercised. The
scripts are reproduced in full below because `scratch/src` is gitignored and this item is their only
durable home.

**Why the shared double implements BOTH provider entry points.** After the change the round path
drives streaming through `chat()` + `onTextDelta`, so a `chat()`-only double would suffice. But today's
`executeStream` would then throw _"Provider must have chatStream method"_ and every scenario would be
red for the wrong reason. Implementing both keeps each red honest and keeps one script valid on both
sides of the change. Once `execution-stream.ts` is deleted, the `chatStream()` half becomes dead weight
and can be dropped.

```ts
// scratch/src/core-042-lib.ts
/**
 * CORE-042 / CORE-032 shared harness for the user-execution scenarios.
 *
 * `ScriptedStreamingProvider` is written against the PUBLIC extension point
 * (`AbstractAIProvider`, exported from `@robota-sdk/agent-core`) exactly as a third-party
 * integrator would write a provider. It implements BOTH provider entry points:
 *   - `chat(messages, { onTextDelta })` — the entry the ROUND path drives streaming through;
 *   - `chatStream(messages)`            — the entry today's `executeStream` drives.
 * so the same script drives the product before and after the change, and the scenarios
 * observe behaviour rather than which internal function was called. No API key, no network.
 */
import { AbstractAIProvider, FunctionTool } from '@robota-sdk/agent-core';

import type {
  IChatOptions,
  IToolCall,
  IToolSchema,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

/** One scripted provider reply. */
export interface IScriptedTurn {
  text?: string;
  toolCalls?: IToolCall[];
  /** Emit deltas until the run signal aborts (used by the abort scenario). */
  streamUntilAborted?: boolean;
}

export type TScript = (messages: TUniversalMessage[], callIndex: number) => IScriptedTurn;

export interface IRecordedCall {
  entry: 'chat' | 'chatStream';
  roles: string[];
  toolNamesOffered: string[];
  options?: IChatOptions;
}

const DELTA_GAP_MS = 15;
const MAX_ABORT_DELTAS = 200;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const pieces = (text: string): string[] => text.match(/.{1,8}/gs) ?? [];

export class ScriptedStreamingProvider extends AbstractAIProvider {
  readonly name = 'scripted-streaming-provider';
  readonly version = '1.0.0';
  /** One entry per provider call, in order. */
  readonly calls: IRecordedCall[] = [];

  constructor(private readonly script: TScript) {
    super();
  }

  private record(
    entry: 'chat' | 'chatStream',
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): IScriptedTurn {
    this.calls.push({
      entry,
      roles: messages.map((m) => m.role),
      toolNamesOffered: (options?.tools ?? []).map((t: IToolSchema) => t.name),
      ...(options ? { options } : {}),
    });
    return this.script(messages, this.calls.length - 1);
  }

  private assistant(content: string, toolCalls?: IToolCall[]): TUniversalMessage {
    return {
      id: `scripted-${this.calls.length}`,
      role: 'assistant',
      content,
      ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
      state: 'complete' as const,
      timestamp: new Date(),
    } as TUniversalMessage;
  }

  /** Round-path entry: streams via `options.onTextDelta`, returns the assembled message. */
  async chat(messages: TUniversalMessage[], options?: IChatOptions): Promise<TUniversalMessage> {
    const turn = this.record('chat', messages, options);
    let emitted = '';
    if (turn.streamUntilAborted === true) {
      for (let i = 0; i < MAX_ABORT_DELTAS; i++) {
        if (options?.signal?.aborted === true) break;
        const piece = `tick${i} `;
        emitted += piece;
        options?.onTextDelta?.(piece);
        await delay(DELTA_GAP_MS);
      }
      return this.assistant(emitted);
    }
    for (const piece of pieces(turn.text ?? '')) {
      if (options?.signal?.aborted === true) break;
      emitted += piece;
      options?.onTextDelta?.(piece);
      await delay(DELTA_GAP_MS);
    }
    return this.assistant(emitted, turn.toolCalls);
  }

  /** Legacy streaming entry: today's `executeStream` calls this one. */
  override async *chatStream(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    const turn = this.record('chatStream', messages, options);
    if (turn.streamUntilAborted === true) {
      for (let i = 0; i < MAX_ABORT_DELTAS; i++) {
        if (options?.signal?.aborted === true) break;
        yield this.assistant(`tick${i} `);
        await delay(DELTA_GAP_MS);
      }
      return;
    }
    for (const piece of pieces(turn.text ?? '')) {
      if (options?.signal?.aborted === true) break;
      yield this.assistant(piece);
      await delay(DELTA_GAP_MS);
    }
    if (turn.toolCalls && turn.toolCalls.length > 0) {
      yield this.assistant('', turn.toolCalls);
    }
  }
}

/** A tool call the scripted model "requests". */
export const toolCall = (id: string, name: string, args: Record<string, unknown>): IToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

/** Provider-free tool: returns a fixed reading the model must consume to answer. */
export const makeWeatherTool = (): FunctionTool =>
  new FunctionTool(
    {
      name: 'get_weather',
      description: 'Return the current temperature for a city.',
      parameters: {
        type: 'object' as const,
        properties: { city: { type: 'string' as const, description: 'City name' } },
        required: ['city'],
      },
    },
    async () => ({ tempC: 21 }),
  );

export const hasToolMessage = (messages: TUniversalMessage[]): boolean =>
  messages.some((m) => m.role === 'tool');

const fails: string[] = [];

export const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) fails.push(label);
};

export const finish = (scenario: string): never => {
  console.log(
    fails.length === 0
      ? `${scenario} PASS`
      : `${scenario} FAIL (${fails.length}): ${fails.join(' | ')}`,
  );
  process.exit(fails.length === 0 ? 0 : 1);
};
```

---

**Scenario 1 — a tool-using `runStream()` turn produces a real final answer, and returns it**

- Agent-executability decision: `agent-executable`.
- Prerequisites: the shared harness above; one `FunctionTool` (`get_weather` → `{ tempC: 21 }`); no
  credentials. The script replies with a tool call while no `role: 'tool'` message is present, and
  with `"It is 21C in Seoul right now."` once one is.
- Steps (from `scratch/`): `node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-042-s1.ts; echo "EXIT:$?"`

```ts
// scratch/src/core-042-s1.ts
/**
 * CORE-042 / CORE-032 Scenario 1 — a tool-using runStream() turn produces a real final answer,
 * and runStream() returns that final assistant text as its generator return value.
 */
import { Robota } from '@robota-sdk/agent-core';

import {
  ScriptedStreamingProvider,
  check,
  finish,
  hasToolMessage,
  makeWeatherTool,
  toolCall,
} from './core-042-lib';

import type { TUniversalMessage } from '@robota-sdk/agent-core';

const FINAL = 'It is 21C in Seoul right now.';

const script = (messages: TUniversalMessage[]) =>
  hasToolMessage(messages)
    ? { text: FINAL }
    : { text: '', toolCalls: [toolCall('call-1', 'get_weather', { city: 'Seoul' })] };

const makeAgent = (provider: ScriptedStreamingProvider, name: string): Robota =>
  new Robota({
    name,
    aiProviders: [provider],
    defaultModel: { provider: 'scripted-streaming-provider', model: 'test-model' },
    tools: [makeWeatherTool()],
    logging: { level: 'silent', enabled: false },
  });

async function main(): Promise<void> {
  // Reference: the non-streaming entry point on the identical config.
  const runProvider = new ScriptedStreamingProvider(script);
  const runAnswer = await makeAgent(runProvider, 'run-agent').run('What is the weather in Seoul?');
  console.log(`run() answer: ${JSON.stringify(runAnswer)}`);
  console.log(`run() provider calls: ${runProvider.calls.length}`);

  // The surface under verification.
  const streamProvider = new ScriptedStreamingProvider(script);
  const agent = makeAgent(streamProvider, 'stream-agent');
  const iterator = agent.runStream('What is the weather in Seoul?');
  const chunks: string[] = [];
  let step = await iterator.next();
  while (step.done !== true) {
    chunks.push(step.value);
    step = await iterator.next();
  }
  const streamed = chunks.join('');
  // Typed `void` on today's non-structured overload — CORE-042 makes it the final assistant text.
  const returned = step.value as unknown;

  console.log(`runStream() streamed text: ${JSON.stringify(streamed)}`);
  console.log(`runStream() return value: ${JSON.stringify(returned)}`);
  console.log(`runStream() provider calls: ${streamProvider.calls.length}`);
  console.log(
    `runStream() history roles: ${JSON.stringify(agent.getHistory().map((m) => m.role))}`,
  );

  check('run(): tool result reached a second provider call', runProvider.calls.length >= 2);
  check('run(): final answer returned', runAnswer === FINAL);

  check(
    'runStream(): the tool ran (a tool message is in history)',
    hasToolMessage(agent.getHistory()),
  );
  check(
    'runStream(): the tool result fed a follow-up provider call',
    streamProvider.calls.length >= 2,
  );
  check('runStream(): the final answer was streamed to the consumer', streamed.includes(FINAL));
  check(
    'runStream(): the last history message is the assistant final answer',
    agent.getHistory().at(-1)?.role === 'assistant' &&
      String(agent.getHistory().at(-1)?.content ?? '').includes(FINAL),
  );
  check('runStream(): generator return value is the final assistant text', returned === FINAL);
  check(
    'both entry points made the same number of provider calls',
    streamProvider.calls.length === runProvider.calls.length,
  );

  finish('SCENARIO 1');
}

void main();
```

- Expected observable result: `SCENARIO 1 PASS`, `EXIT:0` — `runStream()` streams text containing
  `It is 21C in Seoul right now.`; the provider received **≥2** calls (the tool result fed a follow-up
  model call); the last history message is the assistant's final answer; the generator's return value
  equals that text; and the provider call count matches `run()`'s exactly.
  Measured pre-fix (2026-08-16): `EXIT:1`, `SCENARIO 1 FAIL` —
  `runStream() streamed text: "\n[Tool: get_weather executed successfully]"`,
  `return value: undefined`, `provider calls: 1`, `history roles: ["user","assistant","tool"]`,
  against `run()`'s 2 calls and the real answer. **The stream simply stops at the tool result.**
- Cleanup: none — in-memory only.
- Evidence: _to be filled after implementation._

---

**Scenario 2 — `maxExecutionRounds` caps `runStream()` rounds**

- Agent-executability decision: `agent-executable`.
- Prerequisites: as above. The script **always** replies with a tool call, using distinct arguments
  each time so `maxSameToolInputs` is not what stops it — only the round cap can end the turn. Both
  entry points run with `{ maxExecutionRounds: 2 }`.
- Steps: `node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-042-s2.ts; echo "EXIT:$?"`

```ts
// scratch/src/core-042-s2.ts
/**
 * CORE-042 / CORE-032 Scenario 2 — `maxExecutionRounds` caps runStream() rounds, identically
 * to run(). Today runStream() makes exactly one provider call whatever the cap says.
 */
import { Robota } from '@robota-sdk/agent-core';

import {
  ScriptedStreamingProvider,
  check,
  finish,
  makeWeatherTool,
  toolCall,
} from './core-042-lib';

import type { TUniversalMessage } from '@robota-sdk/agent-core';

const MAX_ROUNDS = 2;

/** A model that never stops asking for the tool — only the round cap can end the turn. */
const script = (_messages: TUniversalMessage[], callIndex: number) => ({
  text: '',
  toolCalls: [toolCall(`call-${callIndex}`, 'get_weather', { city: `City-${callIndex}` })],
});

const makeAgent = (provider: ScriptedStreamingProvider, name: string): Robota =>
  new Robota({
    name,
    aiProviders: [provider],
    defaultModel: { provider: 'scripted-streaming-provider', model: 'test-model' },
    tools: [makeWeatherTool()],
    logging: { level: 'silent', enabled: false },
  });

async function main(): Promise<void> {
  const runProvider = new ScriptedStreamingProvider(script);
  const runAgent = makeAgent(runProvider, 'run-agent');
  await runAgent.run('loop please', { maxExecutionRounds: MAX_ROUNDS });
  const runToolMessages = runAgent.getHistory().filter((m) => m.role === 'tool').length;
  console.log(`run(maxExecutionRounds=${MAX_ROUNDS}) provider calls: ${runProvider.calls.length}`);
  console.log(`run() tool messages in history: ${runToolMessages}`);

  const streamProvider = new ScriptedStreamingProvider(script);
  const agent = makeAgent(streamProvider, 'stream-agent');
  for await (const _chunk of agent.runStream('loop please', { maxExecutionRounds: MAX_ROUNDS })) {
    void _chunk;
  }
  console.log(
    `runStream(maxExecutionRounds=${MAX_ROUNDS}) provider calls: ${streamProvider.calls.length}`,
  );
  console.log(
    `runStream() tool messages in history: ${agent.getHistory().filter((m) => m.role === 'tool').length}`,
  );

  check('run(): the cap produced more than one provider call', runProvider.calls.length > 1);
  check('runStream(): the round loop ran more than one round', streamProvider.calls.length > 1);
  check(
    'runStream(): the tool ran once per capped round, same as run()',
    agent.getHistory().filter((m) => m.role === 'tool').length === runToolMessages,
  );
  check(
    'runStream(): the cap holds — provider calls match run() exactly',
    streamProvider.calls.length === runProvider.calls.length,
  );

  finish('SCENARIO 2');
}

void main();
```

- Expected observable result: `SCENARIO 2 PASS`, `EXIT:0` — `runStream()` makes more than one provider
  call, its call count equals `run()`'s under the same cap (3 = 2 capped rounds + the forced summary),
  and its history holds the same number of tool messages (2).
  Measured pre-fix: `EXIT:1` — `run(): 3 calls, 2 tool messages` vs `runStream(): 1 call, 1 tool
message`. The cap is accepted and read by nothing on that path.
- Cleanup: none.
- Evidence: _to be filled after implementation._

---

**Scenario 3 — an aborted `runStream()` commits the partial message as `interrupted`**

- Agent-executability decision: `agent-executable` — the abort is driven programmatically through
  `IRunOptions.signal`, not by a terminal keypress.
- Prerequisites: as above, no tools. The script emits `tick0 tick1 …` 15 ms apart and stops as soon as
  `options.signal.aborted` is true, which is what a real provider does. The consumer aborts after the
  third chunk, keeps consuming to the end (catching a possible abort error), then reads
  `getHistory()`.
- Steps: `node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-042-s3.ts; echo "EXIT:$?"`

```ts
// scratch/src/core-042-s3.ts
/**
 * CORE-042 / CORE-032 Scenario 3 — an aborted runStream() commits the partial assistant
 * message as `interrupted`, exactly as an aborted run() does. Today it is stored as `complete`,
 * indistinguishable from a natural completion.
 */
import { Robota } from '@robota-sdk/agent-core';

import { ScriptedStreamingProvider, check, finish } from './core-042-lib';

const script = () => ({ streamUntilAborted: true });

const makeAgent = (provider: ScriptedStreamingProvider, name: string): Robota =>
  new Robota({
    name,
    aiProviders: [provider],
    defaultModel: { provider: 'scripted-streaming-provider', model: 'test-model' },
    logging: { level: 'silent', enabled: false },
  });

async function main(): Promise<void> {
  const provider = new ScriptedStreamingProvider(script);
  const agent = makeAgent(provider, 'stream-agent');
  const controller = new AbortController();

  let received = 0;
  let thrown: string | undefined;
  try {
    for await (const chunk of agent.runStream('stream forever please', {
      signal: controller.signal,
    })) {
      void chunk;
      received++;
      if (received === 3) controller.abort();
    }
  } catch (error) {
    thrown = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  const history = agent.getHistory();
  const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant');
  console.log(`chunks received before abort: ${received}`);
  console.log(`consumption ended with: ${thrown ?? '(no throw)'}`);
  console.log(
    `stored assistant message: ${JSON.stringify({
      state: lastAssistant?.state,
      content: String(lastAssistant?.content ?? '').slice(0, 40),
    })}`,
  );

  check('the consumer received partial text before aborting', received >= 3);
  check('a partial assistant message was stored', lastAssistant !== undefined);
  check(
    "the aborted partial is stored with state 'interrupted'",
    lastAssistant?.state === 'interrupted',
  );
  check(
    'the stored partial is not indistinguishable from a natural completion',
    lastAssistant?.state !== 'complete',
  );

  finish('SCENARIO 3');
}

void main();
```

- Expected observable result: `SCENARIO 3 PASS`, `EXIT:0` — the stored assistant message carries the
  partial text **and** `state: 'interrupted'`, never `'complete'`. Whether the generator ends cleanly
  or rejects is deliberately **not** asserted: the stored state is the observable, and pinning the
  other would over-specify a choice the plan has not made.
  Measured pre-fix: `EXIT:1` —
  `stored assistant message: {"state":"complete","content":"tick0 tick1 tick2 "}`. An aborted partial
  is recorded indistinguishably from a natural completion.
- Cleanup: none.
- Evidence: _to be filled after implementation._

---

**Scenario 4 — `runStream(input, { output })` validates the post-tool final text**

- Agent-executability decision: `agent-executable`.
- Prerequisites: as above, with the `get_weather` tool and a Zod schema
  `z.object({ city: z.string(), tempC: z.number() })`. Run with `{ outputRetries: 0 }` so exactly one
  attempt is made — a retry would mask the defect.
- Steps: `node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-042-s4.ts; echo "EXIT:$?"`

```ts
// scratch/src/core-042-s4.ts
/**
 * CORE-042 / CORE-032 Scenario 4 — runStream(input, { output }) validates the POST-TOOL final
 * assistant text. Today it validates the concatenation of every chunk (pre-tool text plus the
 * injected "[Tool: … executed successfully]" notices), so a tool-using structured stream can
 * never pass.
 */
import { Robota } from '@robota-sdk/agent-core';
import { z } from 'zod';

import {
  ScriptedStreamingProvider,
  check,
  finish,
  hasToolMessage,
  makeWeatherTool,
  toolCall,
} from './core-042-lib';

import type { TUniversalMessage } from '@robota-sdk/agent-core';

const reportSchema = z.object({ city: z.string(), tempC: z.number() });

const FINAL_JSON = JSON.stringify({ city: 'Seoul', tempC: 21 });

const script = (messages: TUniversalMessage[]) =>
  hasToolMessage(messages)
    ? { text: FINAL_JSON }
    : { text: '', toolCalls: [toolCall('call-1', 'get_weather', { city: 'Seoul' })] };

const makeAgent = (provider: ScriptedStreamingProvider, name: string): Robota =>
  new Robota({
    name,
    aiProviders: [provider],
    defaultModel: { provider: 'scripted-streaming-provider', model: 'test-model' },
    tools: [makeWeatherTool()],
    logging: { level: 'silent', enabled: false },
  });

async function main(): Promise<void> {
  const provider = new ScriptedStreamingProvider(script);
  const agent = makeAgent(provider, 'stream-agent');

  const iterator = agent.runStream('Report the weather in Seoul.', {
    output: reportSchema,
    outputRetries: 0,
  });

  const chunks: string[] = [];
  let validated: unknown;
  let thrown: string | undefined;
  try {
    let step = await iterator.next();
    while (step.done !== true) {
      chunks.push(step.value);
      step = await iterator.next();
    }
    validated = step.value;
  } catch (error) {
    thrown = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  console.log(`streamed text: ${JSON.stringify(chunks.join(''))}`);
  console.log(`validated object: ${JSON.stringify(validated)}`);
  console.log(`error: ${thrown ?? '(none)'}`);

  check('the structured stream did not fail validation', thrown === undefined);
  check('the tool ran inside the structured turn', hasToolMessage(agent.getHistory()));
  check(
    'the validated object is the generator return value',
    JSON.stringify(validated) === JSON.stringify({ city: 'Seoul', tempC: 21 }),
  );
  check(
    'validation saw the post-tool final text, not the tool notices',
    chunks.join('').includes(FINAL_JSON),
  );

  finish('SCENARIO 4');
}

void main();
```

- Expected observable result: `SCENARIO 4 PASS`, `EXIT:0` — no error; the tool ran inside the
  structured turn; the generator's return value deep-equals `{ city: 'Seoul', tempC: 21 }`; and the
  streamed text contains the JSON, i.e. validation saw the post-tool final text rather than the tool
  notices.
  Measured pre-fix: `EXIT:1` — `streamed text: "\n[Tool: get_weather executed successfully]"`,
  `validated object: undefined`,
  `StructuredOutputError: response failed schema validation after 1 attempt(s)`.
- Cleanup: none.
- Evidence: _to be filled after implementation._

---

**Scenario 5 — plugin provider-call hooks and replay events fire on the streaming path**

- Agent-executability decision: `agent-executable`.
- Prerequisites: as above, plus a `ProviderCallRecorder extends AbstractPlugin` counting
  `beforeProviderCall`/`afterProviderCall` and registered through `config.plugins`; both entry points
  also pass `IRunOptions.onExecutionEvent` to collect event names. No tools, single-round script.
- Steps: `node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-042-s5.ts; echo "EXIT:$?"`

```ts
// scratch/src/core-042-s5.ts
/**
 * CORE-042 Scenario 5 — the streaming turn is observable to plugins and to the replay-event
 * callback exactly as the non-streaming turn is: `beforeProviderCall`/`afterProviderCall` fire,
 * and the required replay event families are emitted on `runStream()`.
 *
 * Both surfaces are public: `AbstractPlugin` (exported from `@robota-sdk/agent-core`) and
 * `IRunOptions.onExecutionEvent`.
 */
import { AbstractPlugin, Robota } from '@robota-sdk/agent-core';

import { ScriptedStreamingProvider, check, finish } from './core-042-lib';

import type { TUniversalMessage } from '@robota-sdk/agent-core';

const ANSWER = 'Hello from the scripted model.';

class ProviderCallRecorder extends AbstractPlugin {
  override readonly name = 'provider-call-recorder';
  override readonly version = '1.0.0';
  before = 0;
  after = 0;

  override async beforeProviderCall(_messages: TUniversalMessage[]): Promise<void> {
    this.before++;
  }

  override async afterProviderCall(
    _messages: TUniversalMessage[],
    _response: TUniversalMessage,
  ): Promise<void> {
    this.after++;
  }
}

const makeAgent = (plugin: ProviderCallRecorder, name: string): Robota =>
  new Robota({
    name,
    aiProviders: [new ScriptedStreamingProvider(() => ({ text: ANSWER }))],
    defaultModel: { provider: 'scripted-streaming-provider', model: 'test-model' },
    plugins: [plugin],
    logging: { level: 'silent', enabled: false },
  });

const REQUIRED_EVENTS = [
  'provider_request',
  'provider_stream_raw_delta',
  'provider_response_raw',
  'provider_response_normalized',
  'assistant_message_committed',
];

async function main(): Promise<void> {
  const runPlugin = new ProviderCallRecorder();
  const runEvents: string[] = [];
  await makeAgent(runPlugin, 'run-agent').run('hi', {
    onExecutionEvent: (type: string) => void runEvents.push(type),
  });
  console.log(
    `run(): beforeProviderCall=${runPlugin.before} afterProviderCall=${runPlugin.after} events=${JSON.stringify([...new Set(runEvents)])}`,
  );

  const streamPlugin = new ProviderCallRecorder();
  const streamEvents: string[] = [];
  const agent = makeAgent(streamPlugin, 'stream-agent');
  for await (const _chunk of agent.runStream('hi', {
    onExecutionEvent: (type: string) => void streamEvents.push(type),
  })) {
    void _chunk;
  }
  console.log(
    `runStream(): beforeProviderCall=${streamPlugin.before} afterProviderCall=${streamPlugin.after} events=${JSON.stringify([...new Set(streamEvents)])}`,
  );

  check('run(): beforeProviderCall fired', runPlugin.before >= 1);
  check('run(): afterProviderCall fired', runPlugin.after >= 1);
  check('runStream(): beforeProviderCall fired', streamPlugin.before >= 1);
  check('runStream(): afterProviderCall fired', streamPlugin.after >= 1);
  for (const event of REQUIRED_EVENTS) {
    check(`runStream(): emitted ${event}`, streamEvents.includes(event));
  }

  finish('SCENARIO 5');
}

void main();
```

- Expected observable result: `SCENARIO 5 PASS`, `EXIT:0` — on `runStream()` both hooks fired at least
  once, and the collected events include `provider_request`, `provider_stream_raw_delta`,
  `provider_response_raw`, `provider_response_normalized` and `assistant_message_committed`.
  `history_mutation` is deliberately **not** required here: CORE-033 owns the history-append event
  gaps, and if the seam delivers it anyway that is a bonus rather than a gate.
  Measured pre-fix: `EXIT:1` — `run(): beforeProviderCall=1 afterProviderCall=1` with six event
  families, versus `runStream(): beforeProviderCall=0 afterProviderCall=0 events=[]`. A plugin that
  inspects provider traffic is blind on the streaming path, and no replay event is emitted at all.
- Cleanup: none.
- Evidence: _to be filled after implementation._

---

**Scenario 6 — one agent, one tool inventory**

- Agent-executability decision: `agent-executable`.
- Prerequisites: as above. The agent is constructed with **no** `tools` in its config, and an
  `EchoTool extends AbstractTool` is added afterwards through the public `robota.registerTool()`
  (after `await agent.ensureReady()`, which the tool manager requires). The provider records
  `options.tools` names on the first call of each entry point.
- Steps: `node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-042-s6.ts; echo "EXIT:$?"`

```ts
// scratch/src/core-042-s6.ts
/**
 * CORE-042 Scenario 6 — one agent, one tool inventory. A tool added at runtime through the
 * public `robota.registerTool()` is offered to the model on run() but is invisible on
 * runStream(), because the streaming path asks a different question about which tools exist
 * (`config.tools.length > 0`) than the round path does (the resolved tool registry).
 */
import { AbstractTool, Robota } from '@robota-sdk/agent-core';

import { ScriptedStreamingProvider, check, finish } from './core-042-lib';

import type { IToolSchema } from '@robota-sdk/agent-core';

class EchoTool extends AbstractTool {
  override readonly schema: IToolSchema = {
    name: 'echo_tool',
    description: 'Echo a message back.',
    parameters: {
      type: 'object' as const,
      properties: { message: { type: 'string' as const, description: 'Message' } },
      required: ['message'],
    },
  };

  protected override async executeImpl(): Promise<{ success: true; data: unknown }> {
    return { success: true, data: 'echo' };
  }
}

/** Constructed with NO tools in config — the tool arrives later, as a user would add it. */
const makeAgent = async (provider: ScriptedStreamingProvider, name: string): Promise<Robota> => {
  const agent = new Robota({
    name,
    aiProviders: [provider],
    defaultModel: { provider: 'scripted-streaming-provider', model: 'test-model' },
    logging: { level: 'silent', enabled: false },
  });
  await agent.ensureReady();
  agent.registerTool(new EchoTool());
  return agent;
};

async function main(): Promise<void> {
  const script = () => ({ text: 'done' });

  const runProvider = new ScriptedStreamingProvider(script);
  const runAgent = await makeAgent(runProvider, 'run-agent');
  await runAgent.run('hi');

  const streamProvider = new ScriptedStreamingProvider(script);
  const streamAgent = await makeAgent(streamProvider, 'stream-agent');
  for await (const _chunk of streamAgent.runStream('hi')) void _chunk;

  const runTools = runProvider.calls[0]?.toolNamesOffered ?? [];
  const streamTools = streamProvider.calls[0]?.toolNamesOffered ?? [];
  console.log(`run() tools offered to the model: ${JSON.stringify(runTools)}`);
  console.log(`runStream() tools offered to the model: ${JSON.stringify(streamTools)}`);

  check('run(): the registered tool reached the model', runTools.includes('echo_tool'));
  check('runStream(): the registered tool reached the model', streamTools.includes('echo_tool'));
  check(
    'both entry points offered the model the same tool list',
    JSON.stringify(runTools) === JSON.stringify(streamTools),
  );

  finish('SCENARIO 6');
}

void main();
```

- Expected observable result: `SCENARIO 6 PASS`, `EXIT:0` — `runStream()` offers the model
  `["echo_tool"]`, identical to `run()`.
  Measured pre-fix: `EXIT:1` — `run() tools offered: ["echo_tool"]` vs
  `runStream() tools offered: []`. **A tool the user registered through the public API is invisible to
  the streaming path**, because it asks `config.tools.length > 0` while the round path asks the
  resolved registry.
  _Recorded so it is not re-litigated:_ an earlier draft of this scenario probed the "tool missing a
  `description`" divergence instead, and it did **not** discriminate — `FunctionTool`'s own
  constructor rejects that on both paths, so that half is unreachable through the public tool
  primitive. The tool-list predicate is the user-visible half, and it is what this scenario tests.

- Cleanup: none.
- Evidence: _to be filled after implementation._

---

## Done Gate Evidence

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-16

**Status upgrade:** none — DONE-GATE-STAGE-1 authorizes no status transition. `status: todo` is
unchanged; `done` remains gated by DONE-GATE-STAGE-2.

**Ordering check.** `gate-catalogue.md` > Prior-gate map records DONE-GATE-STAGE-1 as having **no prior
gate**, so the prior-PASS half is exempt. The input state was verified rather than accepted:
`git status --porcelain` shows only `.agents/evals/lessons/auto-lessons.md` and
`.agents/evals/lessons/weekly-digest.md` (auto-generated), **nothing under `packages/` or `apps/`**;
`git diff --stat origin/develop..HEAD -- packages/ apps/` is empty; `git log --oneline
origin/develop..HEAD` is the single commit `34a9b38aa docs(tasks): author CORE-042 user-execution
scenarios`, touching one file (+799/−5). Implementation has not started; scenarios precede it as
required.

**Criterion 1 — exact steps, prerequisites, expected observable result, evidence field.** PASS for all
six. Mechanical field sweep over the section: every scenario carries `Agent-executability decision`,
`Prerequisites`, `Steps`, `Expected observable result`, `Cleanup` and `Evidence` — 6/6 on each field, no
scenario missing any. Each `Steps` line is a literal runnable command; the documented form
`node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-042-s6.ts` was executed verbatim from
`scratch/` and resolved as written. Evidence fields correctly read `_to be filled after implementation._`
— the field must exist at Stage 1, and is populated by Stage 2.

**Criterion 1 (reproducibility of the inlined scripts).** PASS — verified by extraction and execution,
not by inspection. All 7 fenced `ts` blocks were extracted **from this document** into an isolated
directory outside the repo and run there. They are byte-identical to the author's gitignored
`scratch/src/` copies (the only diff is the `// scratch/src/<name>.ts` path label used as the extraction
anchor), so the document alone is a complete and sufficient source. All six ran and reproduced the
recorded pre-fix measurements exactly:

| Scenario | Recorded pre-fix                                                            | Observed on re-run  |
| -------- | --------------------------------------------------------------------------- | ------------------- |
| 1        | `"\n[Tool: get_weather executed successfully]"`, return `undefined`, 1 call | identical, `EXIT:1` |
| 2        | run 3 calls/2 tool msgs vs stream 1 call/1 tool msg                         | identical, `EXIT:1` |
| 3        | `{"state":"complete","content":"tick0 tick1 tick2 "}`                       | identical, `EXIT:1` |
| 4        | `StructuredOutputError … after 1 attempt(s)`, validated `undefined`         | identical, `EXIT:1` |
| 5        | run 1/1 + six event families vs stream `0/0`, `events=[]`                   | identical, `EXIT:1` |
| 6        | run `["echo_tool"]` vs stream `[]`                                          | identical, `EXIT:1` |

Every scenario is red pre-fix for the defect it names, and the expected result is the _opposite_ of the
observed one — the scenarios discriminate, and no expected result was back-fitted to an observation.

**Criterion 2 — executability decision present, with a specific reason for any `manual-only`.** PASS.
All six declare `agent-executable`; none claims `manual-only`, so the specific-reason requirement is
N/A by non-invocation. The claim is not merely asserted — this guardian executed all six via Bash, which
proves agent-executability rather than accepting it. Scenario 3 additionally justifies its decision
("the abort is driven programmatically through `IRunOptions.signal`, not by a terminal keypress"), which
is the correct redesign of an otherwise interactive observable.

**Criterion 3 — the scenario drives a product surface.** PASS for all six. No scenario's observable is a
build, typecheck, lint, test run, harness check, CI check, or an inspection of repository text. Each is a
standalone script driving the **published SDK surface** of `@robota-sdk/agent-core` (`Robota.run`,
`Robota.runStream`, `AbstractAIProvider`, `AbstractPlugin`, `AbstractTool`, `FunctionTool`,
`robota.registerTool()`, `IRunOptions.onExecutionEvent`) — the `public SDK/example usage for SDK-only
features` surface named in `backlog-execution.md`. No vitest/test runner is involved. The scripted
provider is a user-supplied extension point, not a test-framework mock, and is the provider-free fixture
the Scenario Design Preference Order explicitly _prefers_ over a live service. Placement is correct:
scripts live in `scratch/src/`, never under `packages/`.

**Criterion 4 — live-credential / external-service prerequisites stated explicitly.** PASS. No scenario
requires credentials or network; the section states "No API key, no network, no live service" up front.
The recorded probe was re-verified independently: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`,
`GEMINI_API_KEY`, `BYTEDANCE_API_KEY` all resolve empty, and no `.env` exists at the repo root (only
`.env.example`, a template). All six scenarios were then run with no credentials present and produced the
documented results, so the "not needed" half is demonstrated, not claimed.

**Exception clause.** Not invoked — six of six scenarios are written; no unwritten scenario exists.

**Flagged judgement 1 — the dual-entry provider double is justified and contaminates nothing.** The
stated reasoning holds, and was tested rather than reasoned about. Ablation probe (chatStream deleted
from the double): `runStream()` throws `ConfigurationError: Provider must have chatStream method to
support streaming execution` — the exact string at `execution-stream.ts:120`, confirming a `chat()`-only
double would make every scenario red for the wrong reason. Entry-point trace shows the two halves are
disjoint: `run()` records `["chat"]` only, `runStream()` records `["chatStream"]` only. The same ablation
on `run()` leaves it unchanged (answer `"hi there"`, entries `["chat"]`), so the reference arm used by
Scenarios 1/2/5/6 is unaffected by the presence of `chatStream`. `chatStream?` is optional on
`IAIProvider`/`AbstractAIProvider`, so implementing both is contract-conformant, not a widening.

**Flagged judgement 2 — Scenario 3's `complete` observation is product-derived, not an artifact of the
double.** Checked at source because the scenario's whole verdict rests on it. `executeStream` reads only
`chunk.content`, `chunk.role`, `chunk.toolCalls` and usage from each yielded chunk — it never propagates
`chunk.state` — and commits via `conversationStore.addAssistantMessage(...)`, which takes no state
argument. The double's `state: 'complete'` on its yielded chunks is therefore never read. The round path
derives the state itself at `execution-round.ts:217`
(`fullContext.signal?.aborted ? 'interrupted' : 'complete'`), and
`execution-round-streaming.ts:128` already commits `'interrupted'` — so the asserted target is existing
product behaviour on the round path, not a newly invented contract.

**Flagged judgement 3 — Scenario 3's narrowed assertion is a legitimate scoping decision, not a gap.**
The criteria require _an_ expected observable result that is stated and checkable, not every possible
observable. Scenario 3 states one (`state: 'interrupted'`, never `'complete'`) and it discriminates:
`complete` pre-fix, `interrupted` post-fix. Whether the generator rejects on abort is a genuinely open
design choice this item has not made; asserting it would either pin a decision at scenario-authoring
time or produce a red unrelated to the defect. The script still _records_ the behaviour
(`consumption ended with: (no throw)`) without asserting it — observe-but-do-not-over-assert is the
correct shape, and the information is preserved for whoever makes the choice.

**Observation carried forward to DONE-GATE-STAGE-2 (not a Stage-1 finding).** The durable-artifact
evidence rule binds Stage 2, not Stage 1. Because `scratch/src/` is gitignored, Stage-2 evidence must not
cite `scratch/src/*.ts` paths as durable artifacts — the inlined blocks in this item are their durable
home, and the Test Plan's committed suite is the durable repository artifact. Recorded so the Stage-2 run
does not have to rediscover it.

## Implementation Outcome (2026-08-16)

**Delivered.** `packages/agent-core/src/services/execution-stream.ts` is no longer an engine: it is a
105-line adapter that turns the round path's `onTextDelta` callback into an async generator, and
`execution-stream-tools.ts` — the second tool-call loop — is deleted. `ExecutionService.executeStream`
delegates to `execute`, so both public entry points enter one turn.

### What that delivered, and what it revealed

| Capability                                                                                                                           | Before                                                                             | After                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| system prompt, model dials, `toolChoice`, `signal`, `ephemeralSystemContext`, usage, plugin hooks, tool list, tool-schema validation | copied into the second engine one at a time; the system prompt was never copied    | asserted for BOTH entries from one table in `core/__tests__/entry-point-parity.test.ts` |
| multi-round tool loops on `runStream` (CORE-032)                                                                                     | single round                                                                       | the round loop, unchanged                                                               |
| `interrupted` message state on `runStream` (CORE-034)                                                                                | unreachable                                                                        | reached through `execution-round.ts:213`                                                |
| structured output over the streamed text                                                                                             | validated the CONCATENATION of every chunk, so a tool-using turn could never parse | validates the turn's final assistant text, which `robotaRunStream` now returns          |
| forced-summary provider call                                                                                                         | `{ model, onTextDelta }` — no `signal`, no `effort`, no idle timeout               | goes through the same helper as a round call                                            |
| remote seam cancellation                                                                                                             | `fetch` called with no `signal`; every rejection rewrapped as `Request failed`     | signal threaded; an abort surfaces as `AbortError`                                      |

### Two defects found while doing it, absorbed rather than reported

- **Silent history truncation.** History commits the delta buffer, not the returned message, so a
  provider whose deltas stop short of its own assembled text truncated the committed assistant
  message with nothing said. The turn now emits the missing **tail**, which makes the
  emitted-nothing case the same code path rather than a special case; a buffer that is not a prefix
  of the assembled text is a provider contradicting itself, and is logged rather than guessed at.
  Red-proof recorded: without the tail emission the case commits `'The full answer '` for a provider
  that returned `'The full answer is 42.'`.
- **The offline verification scenario encoded the two-engine world.** `examples/verify-offline.ts`'s
  mock answered `chat()` and `chatStream()` differently (`offline:` vs `stream:`) and the scenario
  asserted which engine ran. It now implements the `onTextDelta` contract and asserts the property
  that matters: the same input answers the same through either entry point.

### Deviations from the endorsed plan, stated

- **`createScriptedProvider` did NOT gain `chatStream`**, which this item's own Test Plan asked for.
  Amendment 7 of the endorsed plan supersedes it: after the change the round path drives streaming
  through `chat()` + `onTextDelta`, so a `chatStream` half on the shared double would be dead weight
  the day it was written. The double gained delta emission (conformance with a clause of
  `IAIProvider` it was violating) and `chatOptions` recording (additive, and what makes the
  "both entries build the same options" assertion possible).
- **The remote streaming route was NOT wired**, which the delivery table had listed here. It is
  [CORE-044](CORE-044-remote-executor-drops-every-per-call-option.md): the route does not exist in
  this repository under either spelling, so routing to it would turn a working remote `run()` into a 404. Only the client-local `signal` half landed here, which is the half this item's cancellation
  claim depends on.

### Filed, not fixed here

- **[CORE-045](CORE-045-registertool-throws-on-every-fresh-agent.md)** — `Robota.registerTool()`
  throws on every freshly constructed agent, because the registry it writes to is initialized only by
  the first run. Found because the parity suite tried to use it; the suite registers tools through
  `config.tools` instead. Separate seam, and this PR is already over the size ceiling.

### Verification

- `packages/agent-core`: 1035 tests pass; `pnpm harness:verify --scope packages/agent-core` green
  including the recorded offline scenario.
- `packages/agent-remote-client`: 108 tests pass; `pnpm harness:verify` green.
- Every other workspace package's suite passes. `dag-adapters-sqlite` and `dag-worker` fail locally on
  a missing `better-sqlite3` native binding (`node_modules/.pnpm/better-sqlite3@11.10.0/.../build`
  contains only Makefiles, no compiled `.node`) — an environment fault, pre-existing, and outside this
  change's file set, which touches no `dag-*` package.
- File-size floor: `execution-stream.ts` and `execution-stream-tools.ts` dropped from the baseline;
  `robota-execution.ts` split into a structured-output half and `chat-http-methods.ts` split into a
  streaming half so both stay under the 300-line ceiling; the ratchet re-locked for the three files
  that shrank.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-16

**Status upgrade:** in-progress → done

- **Every scenario executed against the completed implementation.** All six were run from `scratch/`
  as `node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-042-s<N>.ts` against the
  final tree (commit `a57e3a336`) — i.e. after the tail emission, the forced-summary threading and
  the remote `signal` landed, not against the mid-implementation state. Every scenario printed
  `SCENARIO <N> PASS`.
- **Observed matched expected, per scenario.**
  - **S1 — one turn, both entries.** `run()` 2 provider calls; `runStream()` 2 provider calls,
    history `["user","assistant","tool","assistant"]`, streamed text
    `"\n\nIt is 21C in Seoul right now."`, generator return value
    `"It is 21C in Seoul right now."`. Both entries made the same number of calls — the property
    the item exists to establish. Note the return value is the FINAL text and not the concatenation:
    the inter-round separator is present in the stream and absent from the return, which is exactly
    why structured output had to stop validating the concatenation.
  - **S2 — the round cap.** `maxExecutionRounds=2` gives 3 provider calls and 2 tool messages
    through BOTH entries; `runStream()` was a single-round engine before (CORE-032).
  - **S3 — abort.** 3 chunks received, then the stored assistant message is
    `{"state":"interrupted","content":"tick0 tick1 tick2 "}`. `interrupted` had no reachable producer
    on this path before (CORE-034), so a cancelled run was indistinguishable from a completed one.
  - **S4 — structured output over a tool-using stream.** Streamed
    `"\n\n{\"city\":\"Seoul\",\"tempC\":21}"`, validated object `{"city":"Seoul","tempC":21}`,
    no error. Validation saw the post-tool final text rather than the tool notices.
  - **S5 — hooks and replay events.** `beforeProviderCall=1 afterProviderCall=1` and the identical
    event list through both entries: `history_mutation`, `provider_request`,
    `provider_stream_raw_delta`, `provider_response_raw`, `provider_response_normalized`,
    `assistant_message_committed`. The streaming path emitted none of these before.
  - **S6 — the tool list.** `["echo_tool"]` offered through both entries; the two paths previously
    asked different questions about which tools exist.
- **Evidence lives in durable repository artifacts.** `scratch/src` is gitignored, so the scripts'
  durable home is the inlined blocks in this item, and the behaviour they exercise is pinned in the
  repository by `packages/agent-core/src/core/__tests__/entry-point-parity.test.ts` (nine capabilities
  × both entry points) and `packages/agent-core/examples/verify-offline.ts` (a recorded scenario
  run by `pnpm harness:verify --scope packages/agent-core`).
- **No engineering verification is cited as user-execution evidence.** The suites and harness runs are
  recorded separately under _Implementation Outcome_; the evidence in this entry is scenario output.
- **No capability-absence claim is made.** Every scenario was executed; none was passed by exception,
  and none carries `manual-only`.
