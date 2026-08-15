---
title: 'CORE-036: runStream() never applies config.systemMessage — the streaming path builds provider messages straight off the conversation store and skips the session initialization that the round path uses to attach the system prompt, so the same agent obeys its persona through run() and ignores it through runStream()'
status: todo
created: 2026-08-16
priority: high
urgency: now
area: packages/agent-core
depends_on: []
---

# CORE-036: runStream() drops the configured system prompt

Reported by an external user in [issue #1736](https://github.com/woojubb/robota/issues/1736)
(`@robota-sdk/agent-core` 3.0.0-beta.78, re-confirmed against `develop`).

## Problem

`Robota.run()` and `Robota.runStream()` receive an identical `executionConfig`, but only the round
path ever reads `config.systemMessage`. The streaming path takes the conversation store's messages
as-is, so an agent whose entire behavior is defined by its system prompt streams as if it had none.

The failure is silent and mis-attributable: the model answers fluently, just not under its
instructions, which reads as a model-quality problem rather than a dropped prompt.

## Evidence (verified against `develop`, 2026-08-16)

- `packages/agent-core/src/services/execution-service-helpers.ts:189-192` — the round path's
  `initializeConversationStore()` attaches the prompt:
  `const hasSystemMessage = session.getMessages().some((m) => m.role === 'system'); if
(config.systemMessage && !hasSystemMessage) { session.setSystemPrompt(config.systemMessage, {
executionId }); }`
- `packages/agent-core/src/services/execution-stream.ts:72` — the streaming path never calls that
  helper; it goes straight to `conversationHistory.getConversationStore(context.conversationId)`.
- `packages/agent-core/src/services/execution-stream.ts:106-114` — provider messages are the store's
  messages plus, optionally, the _ephemeral_ per-run block only:
  `const conversationMessages = conversationStore.getMessages(); … ephemeralSystemContext …`
- `grep -n "systemMessage" packages/agent-core/src/services/execution-stream.ts` returns no hit —
  the only system-message reference on that path is `ephemeralSystemContext` (SELFHOST-008 P3).
- Both entry points build the config identically (`packages/agent-core/src/core/robota-execution.ts`
  — `robotaRun` and `robotaRunStream`), so the divergence is entirely in the service layer.

Reporter's reproduction: one `Robota` constructed with a `systemMessage` that demands a fixed string
returns that string from `run('hi')` and an unrelated greeting from `runStream('hi')`. Passing a
`signal` makes no difference.

## Impact

Any streaming agent whose behavior is defined by a system prompt behaves as if unconfigured. The
reporter's multi-agent app renders every persona through `runStream()`; it also explains a workaround
they had accumulated — duplicating behavioral rules into the _user_ prompt because
"system-message-only instructions didn't stick".

`runStream()` is the default surface for interactive/TUI usage, so this is a correctness defect on
the most-used path, not an edge case.

## Direction

> **Contained — [CORE-042](CORE-042-the-execution-turn-is-implemented-twice.md)
> ([#1748](https://github.com/woojubb/robota/issues/1748)).** `finding-depth-triager` returned
> `DEPTH: FOUNDATIONAL` on this item's problem statement (2026-08-16). The cause is that agent-core
> implements one declared execution-turn contract twice: `executeStream` re-derives store setup,
> provider resolution, chat options, validation, commit and error classification inline instead of
> entering a shared seam, so every turn capability must be built twice and the forgotten copy fails
> silently. **This is the seventh instance** — six earlier commits are the identical "streaming
> dropped X, copy X in" patch (CORE-016, CORE-017, CORE-018, CORE-020, BEHAVIOR-005,
> SELFHOST-008 P3), two of them external reports against published betas.
>
> The Direction below is nevertheless what lands, as **labelled containment** rather than a fix for
> the cause: this is a live correctness defect in a published beta, so it must land first, it is the
> smallest change that keeps the tree honest, and it introduces no new abstraction — it routes the
> streaming path through the helper that already exists. The seam itself is CORE-042's work, planned
> with CORE-032 and CORE-033.

**Recommendation gate:** `proposal-reviewer` → `REVIEW VERDICT: ENDORSE`, 2026-08-16 (revision 1 of 2;
`REVISE` on v1). The revision withdrew a claim of mine the reviewer falsified — that no reusable
streaming test double existed, and that the shared `./testing` surface therefore had to gain a
`chatStream`. `packages/agent-core/src/core/robota.test.ts:14-53` already records both entry points
into one array and is the double behind the CORE-016/017/018 parity pairs, so no new test
infrastructure is added here and the published-export question does not arise; that work belongs to
CORE-042.

Two effects are observable, not one: the streaming turn gains its system head, and `getHistory()`
therefore carries that head on a streaming-only agent, which reaches `agent-session` persistence.
It is benign — SPEC § System Prompt's resume semantics do not restore persisted `system` messages —
but it is public and is recorded rather than left to be discovered.

**Deliberate deviation from the Test Plan below:** it asks for a SPEC sentence saying the guarantee
"holds for both paths". None is written. § System Prompt is already unconditional and already names
`initializeConversationStore`; per-path wording would institutionalise exactly the parity framing
CORE-042 was filed against.

Do not add a second copy of the prompt-injection logic to `execution-stream.ts` — that is exactly how
the two paths drifted. Route the streaming path through the same session initialization the round
path uses (`initializeConversationStore`, or a shared extraction of it), so `config.systemMessage`,
the "inject once per session" rule (CORE-009/CORE-010) and the ephemeral-block contract are owned in
one place. Confirm the interaction with `Robota.updateSystemPrompt` (`core/robota.ts:315`) is
unchanged.

Related but distinct: CORE-032 (`runStream` is a single-round engine) covers the same file; check
whether the two are better delivered together against one shared session-preparation seam.

## Test Plan

- Unit/integration test asserting the provider receives a `system` message carrying
  `config.systemMessage` for **both** `run()` and `runStream()` — a shared table-driven test over the
  two entry points, so a future divergence fails rather than passing quietly.
- Test covering the resume case: a store that already holds a system message is not given a second
  one by the streaming path (the round path's `hasSystemMessage` guard must hold identically).
- Test covering `ephemeralSystemContext` on the streaming path still being appended to the derived
  provider-message array only, never written to the store.
- `pnpm harness:verify -- --scope packages/agent-core` green.
- `packages/agent-core/docs/SPEC.md` § System Prompt states the guarantee holds for both paths.

## User Execution Test Scenarios

Applies — this changes observable behavior of the published `@robota-sdk/agent-core` SDK surface.

**Surface: provider-free, public extension point.** The scenarios drive the SDK exactly as a
third-party integrator does — a user-written provider implementing `AbstractAIProvider` (exported
from `@robota-sdk/agent-core`) whose `chat`/`chatStream` record the `TUniversalMessage[]` the SDK
hands them. **No API key, no network.**

The live-provider draft this section replaces was rejected on two independent grounds. It is
unrunnable here — probe recorded 2026-08-16: no `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GOOGLE_*` is
set, and `find . -maxdepth 3 -name ".env*"` returns only `.env.example` files, none populated. More
importantly it was the _weaker_ observable even with a key: "the model replied `OK-APPLIED`" is
probabilistic evidence about model compliance, while "the provider received a `system` message whose
content is `config.systemMessage`, at index 0" is a deterministic observation of the thing this
change actually alters.

**Invocation.** Scripts live in `scratch/src/` (the repo's sanctioned home for disposable
live-verification scripts) and are reproduced in full below, because that directory is gitignored and
the item is therefore their only durable home. `pnpm run run` is broken in this environment —
`scratch/node_modules/.bin` was never linked, because `pnpm install` aborted on `better-sqlite3`'s
native build (`make`/`g++` absent) and the workspace was installed with `--ignore-scripts`. Every
command below uses `node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-036-<n>.ts`, run from `scratch/`.

**Stated limitation.** `--conditions=source` exercises the TypeScript sources, not `dist/`. That is a
real gap versus what a package consumer installs, and it is forced here by the same missing native
toolchain. Where a working toolchain exists, dropping the flag after `pnpm build` strengthens every
scenario below at no cost to its design.

**Shared harness**

```ts
// scratch/src/core-036-lib.ts
/**
 * CORE-036 shared harness for the user-execution scenarios.
 *
 * RecordingProvider is written against the PUBLIC extension point (`AbstractAIProvider`,
 * exported from `@robota-sdk/agent-core`) exactly as a third-party integrator would write a
 * provider. It records the message array the SDK hands it, so the scenarios observe the real
 * provider request with no API key and no network.
 */
import { AbstractAIProvider } from '@robota-sdk/agent-core';

import type { IChatOptions, TUniversalMessage } from '@robota-sdk/agent-core';

export class RecordingProvider extends AbstractAIProvider {
  readonly name = 'recording-provider';
  readonly version = '1.0.0';
  /** One entry per provider call: the message array the SDK sent. */
  readonly received: TUniversalMessage[][] = [];

  async chat(messages: TUniversalMessage[], _options?: IChatOptions): Promise<TUniversalMessage> {
    this.received.push([...messages]);
    return {
      id: `chat-${this.received.length}`,
      role: 'assistant',
      content: 'ack',
      state: 'complete' as const,
      timestamp: new Date(),
    };
  }

  override async *chatStream(
    messages: TUniversalMessage[],
    _options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    this.received.push([...messages]);
    yield {
      id: `stream-${this.received.length}`,
      role: 'assistant',
      content: 'ack',
      state: 'complete' as const,
      timestamp: new Date(),
    };
  }
}

export const systemContents = (msgs: TUniversalMessage[]): string[] =>
  msgs.filter((m) => m.role === 'system').map((m) => String(m.content));

export const show = (label: string, msgs: TUniversalMessage[]): void => {
  console.log(
    `${label}: ${JSON.stringify(msgs.map((m) => ({ role: m.role, content: m.content })))}`,
  );
};

export const drain = async (it: AsyncIterable<string>): Promise<string> => {
  let out = '';
  for await (const c of it) out += c;
  return out;
};

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

**Scenario 1 — `config.systemMessage` reaches the provider on `runStream()`, identically to `run()`**

- Agent-executability decision: `agent-executable`.
- Prerequisites: workspace installed; no services, credentials, or environment variables.
- Steps (from `scratch/`): write the harness and the script below, then run
  `node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-036-s1.ts; echo "EXIT:$?"`.

```ts
// scratch/src/core-036-s1.ts
/**
 * CORE-036 Scenario 1 — the configured system message reaches the provider on runStream(),
 * identically to run().
 */
import { Robota } from '@robota-sdk/agent-core';

import { RecordingProvider, check, drain, finish, show, systemContents } from './core-036-lib';

const SYS = 'Reply with exactly the string OK-APPLIED and nothing else.';

const makeAgent = (provider: RecordingProvider, name: string): Robota =>
  new Robota({
    name,
    aiProviders: [provider],
    defaultModel: { provider: 'recording-provider', model: 'test-model' },
    systemMessage: SYS,
  });

async function main(): Promise<void> {
  const runProvider = new RecordingProvider();
  await makeAgent(runProvider, 'run-agent').run('hi');
  const runMessages = runProvider.received[0] ?? [];

  const streamProvider = new RecordingProvider();
  await drain(makeAgent(streamProvider, 'stream-agent').runStream('hi'));
  const streamMessages = streamProvider.received[0] ?? [];

  show('run() provider request', runMessages);
  show('runStream() provider request', streamMessages);

  check('run(): exactly one system message', systemContents(runMessages).length === 1);
  check('run(): it is config.systemMessage', systemContents(runMessages)[0] === SYS);
  check('runStream(): exactly one system message', systemContents(streamMessages).length === 1);
  check('runStream(): it is config.systemMessage', systemContents(streamMessages)[0] === SYS);
  check('runStream(): it is the head (index 0)', streamMessages[0]?.role === 'system');
  check(
    'both paths sent an identical system head',
    JSON.stringify(systemContents(runMessages)) === JSON.stringify(systemContents(streamMessages)),
  );

  finish('SCENARIO 1');
}

void main();
```

- Expected observable result: `SCENARIO 1 PASS`, `EXIT:0`. `run()` and `runStream()` each recorded
  **exactly one** `system` message; its content equals `config.systemMessage`; on the streaming path
  it is at index 0; and the two paths' system heads are identical. The printed
  `runStream() provider request` opens with
  `{"role":"system","content":"Reply with exactly the string OK-APPLIED and nothing else."}`.
  Measured pre-fix (2026-08-16, unfixed `e07593977`): `SCENARIO 1 FAIL (4)`, `EXIT:1` —
  `run() provider request` carried the system head while
  `runStream() provider request: [{"role":"user","content":"hi"}]` carried no system message at all.
- Cleanup: none — nothing is persisted and `git status --porcelain scratch/` stays empty.
- Evidence (2026-08-16, run against the completed implementation on this branch): **`SCENARIO 1 PASS`,
  `EXIT:0`**, six `PASS` lines. Both requests now open identically:
  `run() provider request: [{"role":"system","content":"Reply with exactly the string OK-APPLIED and nothing else."},{"role":"user","content":"hi"}]`
  and `runStream() provider request:` byte-identical to it.

---

**Scenario 2 — exactly one system head, ever**

- Agent-executability decision: `agent-executable`.
- Prerequisites: as scenario 1.
- Steps (from `scratch/`): run
  `node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-036-s2.ts; echo "EXIT:$?"`.
  One agent drives `runStream('turn one')` → `runStream('turn two')` → `run('turn three')`.

```ts
// scratch/src/core-036-s2.ts
/**
 * CORE-036 Scenario 2 — exactly one system head, ever. A second streaming turn, and a run()
 * after a runStream() on the same agent, must not add a second system message.
 */
import { Robota } from '@robota-sdk/agent-core';

import { RecordingProvider, check, drain, finish, show, systemContents } from './core-036-lib';

const SYS = 'You are PERSONA-ALPHA.';

async function main(): Promise<void> {
  const provider = new RecordingProvider();
  const agent = new Robota({
    name: 'idempotence-agent',
    aiProviders: [provider],
    defaultModel: { provider: 'recording-provider', model: 'test-model' },
    systemMessage: SYS,
  });

  await drain(agent.runStream('turn one'));
  await drain(agent.runStream('turn two'));
  await agent.run('turn three');

  provider.received.forEach((msgs, i) => show(`provider call ${i + 1}`, msgs));
  const history = agent.getHistory();
  show('getHistory()', history);

  check('provider was called three times', provider.received.length === 3);
  provider.received.forEach((msgs, i) => {
    check(`call ${i + 1}: exactly one system message`, systemContents(msgs).length === 1);
    check(`call ${i + 1}: it is config.systemMessage`, systemContents(msgs)[0] === SYS);
    check(`call ${i + 1}: it is the head (index 0)`, msgs[0]?.role === 'system');
  });
  check('getHistory(): exactly one system message', systemContents(history).length === 1);
  check('getHistory(): it is the head (index 0)', history[0]?.role === 'system');

  finish('SCENARIO 2');
}

void main();
```

- Expected observable result: `SCENARIO 2 PASS`, `EXIT:0`. Each of the three provider calls carries
  exactly one `system` message equal to `'You are PERSONA-ALPHA.'` at index 0 — the second streaming
  turn adds no second head, and neither does the trailing `run()`. `getHistory()` holds exactly one
  `system` message, at the head. This is SPEC § System Prompt's "exactly one, at the head" asserted
  through the public surface.
  Measured pre-fix: `SCENARIO 2 FAIL (6)`, `EXIT:1` — neither streaming call carried a system
  message, and `provider call 3` (the `run()`) was the first to carry one, injected at the head
  **mid-conversation**. That is the user-visible shape of the defect: an agent used through both
  entry points only acquires its persona from the first non-streaming turn onward.
- Cleanup: none.
- Evidence (2026-08-16, run against the completed implementation on this branch): **`SCENARIO 2 PASS`,
  `EXIT:0`**. All three provider calls now open with
  `{"role":"system","content":"You are PERSONA-ALPHA."}` — including calls 1 and 2, the streaming
  turns that previously carried none — and `getHistory()` holds exactly one system message, at the
  head, after two streaming turns and a round turn on one agent.

---

**Scenario 3 — `ephemeralSystemContext` still reaches the request and still never reaches the store**

- Agent-executability decision: `agent-executable`.
- Prerequisites: as scenario 1.
- Steps (from `scratch/`): run
  `node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-036-s3.ts; echo "EXIT:$?"`.

```ts
// scratch/src/core-036-s3.ts
/**
 * CORE-036 Scenario 3 — with a real system head now on the streaming path,
 * IRunOptions.ephemeralSystemContext still reaches the provider request and is still never
 * written to the conversation store.
 */
import { Robota } from '@robota-sdk/agent-core';

import { RecordingProvider, check, drain, finish, show, systemContents } from './core-036-lib';

const SYS = 'You are PERSONA-ALPHA.';
const EPHEMERAL = 'RECALLED-MEMORY-BLOCK-XYZ';

async function main(): Promise<void> {
  const provider = new RecordingProvider();
  const agent = new Robota({
    name: 'ephemeral-agent',
    aiProviders: [provider],
    defaultModel: { provider: 'recording-provider', model: 'test-model' },
    systemMessage: SYS,
  });

  await drain(agent.runStream('hi', { ephemeralSystemContext: EPHEMERAL }));

  const sent = provider.received[0] ?? [];
  const history = agent.getHistory();
  show('provider request', sent);
  show('getHistory()', history);

  check('provider request carries config.systemMessage', systemContents(sent).includes(SYS));
  check('provider request carries the ephemeral block', systemContents(sent).includes(EPHEMERAL));
  check(
    'config.systemMessage is the head (index 0)',
    sent[0]?.role === 'system' && String(sent[0]?.content) === SYS,
  );
  check('store carries config.systemMessage', systemContents(history).includes(SYS));
  check(
    'store does NOT carry the ephemeral block',
    !history.some((m) => String(m.content).includes(EPHEMERAL)),
  );

  finish('SCENARIO 3');
}

void main();
```

- Expected observable result: `SCENARIO 3 PASS`, `EXIT:0`. The provider request carries **both**
  system blocks — `'You are PERSONA-ALPHA.'` at index 0 and `'RECALLED-MEMORY-BLOCK-XYZ'` present —
  while `getHistory()` carries the configured system message and **no trace** of the ephemeral block.
  This proves the SELFHOST-008 P3 contract survives the new store initialization rather than being
  flattened into it.
  Measured pre-fix: `SCENARIO 3 FAIL (3)`, `EXIT:1` — the ephemeral block was the _only_ system
  message in the request and the configured one was absent. The two contract-preservation checks
  (request carries the ephemeral block; store does not) already passed and must continue to.
- Cleanup: none.
- Evidence (2026-08-16, run against the completed implementation on this branch): **`SCENARIO 3 PASS`,
  `EXIT:0`**.
  `provider request: [{"role":"system","content":"You are PERSONA-ALPHA."},{"role":"user","content":"hi"},{"role":"system","content":"RECALLED-MEMORY-BLOCK-XYZ"}]`
  — both blocks present, the configured one at index 0 — while
  `getHistory(): [{"role":"system","content":"You are PERSONA-ALPHA."},{"role":"user","content":"hi"},{"role":"assistant","content":"ack"}]`
  carries no trace of the ephemeral block. The SELFHOST-008 P3 contract survives the new store
  initialization.

---

**Scenario 4 — `updateSystemPrompt()` still wins on the streaming path (regression guard)**

- Agent-executability decision: `agent-executable`.
- **This scenario passes on the unfixed code** (measured: `EXIT:0`), so it is _not_ evidence the
  change landed — scenarios 1–3 are. It is here because the Direction requires confirming the
  `Robota.updateSystemPrompt` interaction is unchanged, and because this fix introduces the risk:
  routing the streaming path through `initializeConversationStore` runs the `hasSystemMessage` guard
  and `setSystemPrompt(config.systemMessage)`, so a mis-ordered implementation could revert a
  live-updated head to `config.systemMessage`, or append a second one. Scenarios 1–3 would not see
  either.
- Prerequisites: as scenario 1.
- Steps (from `scratch/`): run
  `node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-036-s4.ts; echo "EXIT:$?"`.

```ts
// scratch/src/core-036-s4.ts
/**
 * CORE-036 Scenario 4 (regression guard) — Robota.updateSystemPrompt() keeps winning on the
 * streaming path after it is routed through initializeConversationStore. The live-updated head
 * must NOT be reverted to config.systemMessage, and must not be joined by a second head.
 */
import { Robota } from '@robota-sdk/agent-core';

import { RecordingProvider, check, drain, finish, show, systemContents } from './core-036-lib';

async function main(): Promise<void> {
  const provider = new RecordingProvider();
  const agent = new Robota({
    name: 'update-prompt-agent',
    aiProviders: [provider],
    defaultModel: { provider: 'recording-provider', model: 'test-model' },
    systemMessage: 'ALPHA',
  });

  agent.updateSystemPrompt('BETA');
  await drain(agent.runStream('one'));
  agent.updateSystemPrompt('GAMMA');
  await drain(agent.runStream('two'));

  provider.received.forEach((msgs, i) => show(`provider call ${i + 1}`, msgs));
  const history = agent.getHistory();
  show('getHistory()', history);

  const first = provider.received[0] ?? [];
  const second = provider.received[1] ?? [];

  check('call 1: exactly one system message', systemContents(first).length === 1);
  check('call 1: it is the updated BETA, not ALPHA', systemContents(first)[0] === 'BETA');
  check('call 2: exactly one system message', systemContents(second).length === 1);
  check('call 2: it is the updated GAMMA, not ALPHA/BETA', systemContents(second)[0] === 'GAMMA');
  check('call 2: it is still the head (index 0)', second[0]?.role === 'system');
  check(
    'getHistory(): exactly one system message, GAMMA',
    systemContents(history).join('|') === 'GAMMA',
  );

  finish('SCENARIO 4');
}

void main();
```

- Expected observable result: `SCENARIO 4 PASS`, `EXIT:0`. Provider call 1 carries exactly one system
  message, `'BETA'` (not `'ALPHA'`); call 2 carries exactly one, `'GAMMA'`, still at index 0;
  `getHistory()` holds exactly one, `'GAMMA'`. `'ALPHA'` never reappears and there are never two
  heads. The post-fix run must reproduce the pre-fix output.
- Cleanup: none.
- Evidence (2026-08-16, run against the completed implementation on this branch): **`SCENARIO 4 PASS`,
  `EXIT:0`**, reproducing the pre-fix output exactly:
  `provider call 1: [{"role":"system","content":"BETA"},…]`,
  `provider call 2: [{"role":"system","content":"GAMMA"},…]`, and `getHistory()` holding exactly one
  system message, `GAMMA`. The live-updated head is neither reverted to `config.systemMessage` nor
  duplicated. Per the stage-1 gate's binding, this scenario is **not** cited as evidence the change
  landed — scenarios 1–3 carry that; this one shows the fix introduced no regression here.

---

**Deliberately not covered.** The `agent-session` persistence leg of the second observable effect —
that a streaming-only agent's `getHistory()` now carries a system head, which reaches persistence.
Scenario 2 observes the head's presence and singularity through `getHistory()`, but the
persistence/resume leg needs an `agent-session` store fixture. It is documented as benign (SPEC
§ System Prompt resume semantics do not restore persisted `system` messages) and outside this item's
blast radius; named here so the omission is a decision rather than an oversight.

---

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-16

**Status upgrade:** none — Stage 1 is not a status transition. `status: todo` is unchanged; the
routing on this verdict belongs to the orchestrator, not to this gate.

**Ordering check (exempt gate, process precondition verified anyway):** DONE-GATE-STAGE-1 has no
prior gate (gate catalogue > Prior-gate map). The "scenarios before implementation" precondition of
`backlog-execution.md` § User Execution Test Scenario Rule was verified rather than assumed on branch
`fix/core-036-runstream-system-prompt`: `git diff --name-only origin/develop..HEAD` returns only
`.agents/tasks/CORE-036-*.md` and `.agents/tasks/CORE-042-*.md` across all three commits
(`9fae91889`, `e07593977`, `699c39ad4`, all `docs(tasks):`); `git status --porcelain` shows nothing
under `packages/` or `apps/` (only two pre-existing `.agents/evals/lessons/` auto-generated files).
No implementation preceded this gate.

**Per criterion:**

- **Field completeness (exact steps, prerequisites, expected observable, evidence field)** — met for
  all 4. Each scenario carries: the exact command
  `node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-036-s<n>.ts; echo "EXIT:$?"`
  with its working directory (`scratch/`); a prerequisite line (S1 "workspace installed; no services,
  credentials, or environment variables", S2–S4 "as scenario 1"); an expected observable naming both
  the exit code and the exact output substring (`SCENARIO <n> PASS`, `EXIT:0`, plus the concrete
  message shape, e.g. S1's `{"role":"system","content":"Reply with exactly the string OK-APPLIED and
nothing else."}`); a cleanup line (`none` — verified: `git status --porcelain` is unchanged after a
  full four-scenario run); and an `Evidence: _to be filled after implementation._` field.
- **Executability decision on every scenario** — met. All 4 are labelled `agent-executable`; none
  claims `manual-only`, so no technical-reason bar applies. Verified as true rather than asserted:
  all four were run from Bash during this gate.
- **Drives a product surface, not engineering verification** — met. The observable is the
  `TUniversalMessage[]` the SDK hands a user-written `AbstractAIProvider` (a public export of
  `@robota-sdk/agent-core`) plus `agent.getHistory()` — public SDK usage, which
  `backlog-execution.md` names as a product surface for an SDK-only feature. No scenario's observable
  is a build, typecheck, lint, `pnpm test`, harness, CI, or repository-text inspection; those live
  separately in `## Test Plan`. Noted, not failed: `--conditions=source` runs the TS sources rather
  than `dist/`, which the item states explicitly as a limitation with the remedy (drop the flag after
  `pnpm build` where a native toolchain exists).
- **Credential / external-service prerequisite stated explicitly** — met affirmatively. The section
  states "**No API key, no network**", and records the probe that rejected the live-provider draft
  (no `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GOOGLE_*`; `find . -maxdepth 3 -name ".env*"` yielding
  only unpopulated `.env.example`). An executor learns from the scenario, not from a failure, that
  nothing external is required.
- **Reproducibility of the inlined scripts (checked because `scratch/src/` is gitignored)** — met.
  The 5 fenced `ts` blocks were extracted from this document alone into a fresh directory and
  executed: reconstructed Scenario 1 produced `SCENARIO 1 FAIL (4)` and reconstructed Scenario 4
  produced `SCENARIO 4 PASS`, matching the on-disk runs exactly. The document text is byte-identical
  to `scratch/src/core-036-{lib,s1,s2,s3,s4}.ts` apart from the added `// scratch/src/<file>` path
  header. The item is a sufficient durable home for the scripts. Temp reconstruction directory was
  removed; working tree unchanged.
- **Recorded pre-fix measurements (verifiable claims, so verified)** — all four reproduce exactly at
  `e07593977`: S1 `FAIL (4)` `EXIT:1` with `runStream() provider request: [{"role":"user","content":"hi"}]`;
  S2 `FAIL (6)` `EXIT:1` with calls 1–2 headless and call 3 injecting mid-conversation; S3 `FAIL (3)`
  `EXIT:1` with the ephemeral block as the only system message; S4 `PASS` `EXIT:0`.

**Ruling on Scenario 4 (a scenario that passes on unfixed code) — admissible.** Stage 1 requires
completeness, a product surface, and stated prerequisites; it does not require that every scenario
fail pre-fix. S4 guards a risk this fix introduces (routing through `initializeConversationStore`
could revert a live-updated head to `config.systemMessage` or append a second one) that scenarios 1–3
structurally cannot see, and the Direction requires confirming the `updateSystemPrompt` interaction
is unchanged. Its expectation is derived from the contract and pinned to a measured pre-fix baseline,
so it cannot be back-fitted to a post-fix observation. The item labels it explicitly as not evidence
the change landed. **Binding for Stage 2:** S4 alone may not be cited as evidence the fix landed —
scenarios 1–3 carry that burden; S4's post-fix run must reproduce `SCENARIO 4 PASS` / `EXIT:0`.

**Containment scope** — consistent. `finding-depth-triager` `DEPTH: FOUNDATIONAL` and the root item
`CORE-042` (`.agents/tasks/CORE-042-the-execution-turn-is-implemented-twice.md`, verified present)
are recorded in `## Direction`, with `proposal-reviewer` `REVIEW VERDICT: ENDORSE` (2026-08-16,
revision 1 of 2). The scenarios correctly verify the contained fix's observable behaviour, not the
root cause. The `Deliberately not covered` note (the `agent-session` persistence leg) is a stated
non-coverage decision with a reason, not an unwritten scenario, so the Stage-1 exception clause is
not invoked.
