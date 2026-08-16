---
title: 'CORE-044: the remote provider seam implements none of the IChatOptions contract at either end — the client sends no options, the server drops the `tools` the client does send so a remote agent silently has NO TOOLS, and the streaming client posts to a route the server does not serve, spelled two different ways'
status: done
created: 2026-08-16
completed: 2026-08-16
priority: critical
urgency: soon
area: packages/agent-remote-client, apps/agent-server
depends_on: [CORE-042]
---

# CORE-044: the remote seam implements none of the contract it declares

Found while planning [CORE-042](completed/CORE-042-the-execution-turn-is-implemented-twice.md), which made the
gap load-bearing: once the streaming entry becomes an adapter over the round path, a remote provider
that ignores `signal` is a turn that cannot be cancelled.

## Problem

`IChatOptions` carries `signal`, `onTextDelta`, `toolChoice`, `maxTokens`, `temperature` and `effort`.
The remote provider seam implements **none** of it, at **both** ends — and the damage is worse than
options.

### The server silently discards the agent's tools

`apps/agent-server/src/app.ts:121` destructures `{ provider, messages, model }` and `:138` calls
`provider.chat(messages, { model })`. The client **does** send `tools`
(`chat-http-methods.ts:99-104`) — the server never reads them. So **a remote-executor agent has no
tools at all**, and nothing anywhere says so: the model simply never calls one. The BYOK handler
(`:147-193`) has the identical shape.

That is the same silent-drop failure class CORE-042 exists to end, at a different seam, and it is
user-facing: an agent configured with tools appears to work and quietly cannot act.

### There is no streaming route in this repository

The server's entire route table is `remote/health`, `remote/chat`, `byok/chat`, `/`,
`remote/ws/status`, `/health`, and the playground router. There is **no** stream route. Meanwhile:

- `chat-http-methods.ts:174` posts to `${baseUrl}/stream`,
- `request-handler-simple.ts:47-48` names a third spelling, `/chat/stream`,
- `app.ts:111` and `apps/agent-server/docs/SPEC.md:31` both claim "Provider chat/stream routes are
  inlined" — only the chat route actually was.

So the streaming client points at an endpoint that does not exist, under two spellings, while the
documentation asserts it does.

### And every per-call option is dropped, in both directions

- **Client.** `SimpleRemoteExecutor.executeChat`
  (`packages/agent-remote-client/src/client/remote-executor-simple.ts:110-124`) calls
  `httpClient.chat(messages, provider, model, request.tools)`, and `HttpClient.chat`
  (`client/http-client.ts:71-86`) has **no options parameter at all**. The body is
  `{ messages, provider, model, tools }`; `fetch` is called with no `signal` (`:108-118`).
- **Server.** As above — even if the client sent them, the handler would drop them.

`LocalExecutor` forwards `request.options` correctly
(`agent-core/src/executors/local-executor.ts:104-108`), so this is the remote path specifically, not
the executor contract.

## What each dropped thing costs

- **`tools`** — the agent cannot act. Silent, and the most serious of these.
- **`signal`** — the remote path is **uncancellable**: the same class as CORE-018 (fixed for the
  streaming path) and RUNTIME-004, on a seam neither covered.
- **`toolChoice`** — CORE-017's forcing directive is silently ignored; `'required'` and a named tool
  degrade to `'auto'` with no signal to the caller.
- **`maxTokens` / `temperature` / `effort`** — CORE-016's run-scoped options are silently ignored, the
  same defect CORE-016 fixed on the streaming path.
- **`onTextDelta`** — a function cannot cross a wire; restoring live deltas needs a streaming route
  that does not currently exist.

**Nothing tests any of this.** That is the mechanism, not an aside: the seam declares a contract, no
test asserts the contract at the boundary, and each dropped member was found only by reading.

## Why this is not part of CORE-042

Both halves were considered for that unit and split out on the reviewer's ruling, for reasons of
correctness and size rather than authority:

1. **The streaming route does not exist**, so routing `executeChat` to it would turn a working remote
   `run()` into a 404. That alone settles it.
2. **The delta predicate is not narrow either.** `execution-round-streaming.ts:80-88` passes
   `onTextDelta` **unconditionally on every round-path provider call**, not gated on the caller
   supplying one. So "route to the streaming surface when a delta callback is present" would move
   **100% of remote traffic, including every plain `run()`**, onto it — a transport migration, not a
   narrow restoration.
3. **It needs an assembler CORE-042 deletes.** `remote-executor-simple.ts:166` says so itself —
   _"yield every chunk as-is (ExecutionService merges them)"_ — and the merger is the tool-call
   fragment accumulator CORE-042 removes with `execution-stream.ts`. Porting that into the remote
   client, against a fragmentation behaviour that cannot be observed in-repo, risks silently corrupting
   tool calls: the same silent-failure class CORE-042 exists to end.
4. CORE-042 already exceeds the soft PR ceiling, and this work must additionally design the wire
   representation of the options, decide whether a streaming route is implemented at all, and pick a
   transport for it (SSE or chunked) — a unit of its own, not a loose end of another.

CORE-042 does land the one piece that is genuinely client-local and that its own cancellation claim
depends on: `signal` threaded into `fetch`.

**Accepted in the meantime, stated rather than discovered:** on the remote seam `runStream()` yields
one terminal chunk rather than live deltas — which is exactly what `run()` does there today, so it is
not a regression.

## Not an owner decision

An earlier framing reserved the wire-schema half for the owner as "an externally visible contract".
**That is withdrawn.** It is agent-authority work like any other. Both ends are in this repository, no stable version has been released, the
current beta is not distributed, and the rules forbid keeping legacy or compatibility code
(`code-quality.md:50` — _"unreleased — no backward-compat constraint"_). The reservation in
`backlog-execution.md` § Agent Decision Authority exists for coordination cost with parties who cannot
be updated; here there are none.

## Direction

Make the remote seam implement the contract it declares, and prove it at the boundary. Carry
`IChatOptions` end to end. The client sends the serializable options in the POST body and threads
`signal` into `fetch`; the server handler forwards them into `provider.chat`. `onTextDelta` is handled
by routing to the streaming surface and assembling client-side — which is only safe once the fragment
assembly it depends on has an owner, so sequence it after CORE-042 lands.

The `/chat` and `/chat/stream` bodies should carry the options as one object rather than as parallel
top-level fields, so a future option does not require touching both ends again — the parallel-collection
failure mode `code-quality.md` names.

## Test Plan

- **The tools regression first, red:** a remote-executor agent with a registered tool reaches the
  provider with that tool. It does not today.
- Either implement the streaming route or delete the client that posts to it — a client calling an
  endpoint nobody serves, under two spellings, with the SPEC claiming otherwise, is worse than either.
- Client: the POST body carries `toolChoice`/`maxTokens`/`temperature`/`effort` when the caller sets
  them, and `fetch` receives the run's `signal` (the existing `vi.mock('../http-client')` seam in
  `remote-executor-simple.test.ts` covers the first half).
- Server: the handler forwards the received options into `provider.chat`, asserted with a recording
  provider.
- An aborted remote run rejects rather than running to completion.
- A remote run with `toolChoice: 'required'` reaches the provider with that directive.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies** — both ends are published surfaces: `RemoteExecutor` is exported from
`@robota-sdk/agent-remote-client`, and the chat routes are what `apps/agent-server` deploys.

**No API key, no network to any provider.** Credential probe recorded 2026-08-16: `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY` and `BYTEDANCE_API_KEY` all unset, no `.env`
present. Neither scenario needs one: Scenario 1's observable IS the HTTP request the client builds,
and Scenario 2's discriminating observations are the server's refusals, which happen before any
provider call.

**Invocation.** From `scratch/`:
`node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-044-s<N>.ts`. The scripts are
reproduced in full because `scratch/src` is gitignored and this item is their durable home.
`@robota-sdk/agent-remote-client` was added to `scratch/package.json` so the scenario can import the
package the way a consumer does, rather than reaching into `src/`.

### Scenario 1 — the client sends the tools and the options

- Surface: `RemoteExecutor` from `@robota-sdk/agent-remote-client`, driven through
  `IExecutor.executeChat` exactly as `AbstractAIProvider.chat` drives it. Only `globalThis.fetch` is
  stubbed, because the request itself is the observable.
- Expected observable result: `SCENARIO 1 PASS`, `EXIT:0` — `tools` carries `get_weather`, `options`
  carries `toolChoice`/`maxTokens`/`temperature`/`effort`, `fetch` receives a signal, nothing
  unserializable appears in the body, and the options are ONE object rather than parallel top-level
  fields.
- Evidence: executed 2026-08-16 against the completed implementation; **EXIT:0**. Full output:

```text
request url: https://example.invalid/api/v1/remote/chat
tools on the wire: ["get_weather"]
options on the wire: {"maxTokens":256,"temperature":0.2,"effort":"high","toolChoice":"required"}
fetch received a signal: true
unserializable members leaked: []
PASS the agent's tool reached the wire
PASS toolChoice reached the wire
PASS maxTokens reached the wire
PASS temperature reached the wire
PASS effort reached the wire
PASS the run signal reached fetch, so a remote call is cancellable
PASS nothing unserializable leaked into the body
PASS options travel as ONE object, not parallel top-level fields
SCENARIO 1 PASS
```

```ts
// scratch/src/core-044-s1.ts
/**
 * CORE-044 Scenario 1 — a remote-executor agent's tools and per-call options reach the wire.
 *
 * Written against the PUBLIC surface a third-party integrator uses: `RemoteExecutor` from
 * `@robota-sdk/agent-remote-client`, driven through `IExecutor.executeChat` exactly as
 * `AbstractAIProvider.chat` drives it. The only thing stubbed is `globalThis.fetch`, because the
 * observable under test IS the HTTP request the client builds — no API key, no network, no server.
 *
 * Before this change the request body was `{ messages, provider, model, tools }` with the tools
 * present but read by nobody at the far end, and no options at all. The most serious consequence was
 * silent: an agent configured with tools reached the model with none.
 */
import { RemoteExecutor } from '@robota-sdk/agent-remote-client';

import type { IChatExecutionRequest } from '@robota-sdk/agent-core';

interface ICapturedRequest {
  url: string;
  body: Record<string, unknown>;
  hadSignal: boolean;
}

const captured: ICapturedRequest[] = [];

globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  captured.push({
    url: String(url),
    body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    hadSignal: Boolean(init?.signal),
  });
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    json: async () => ({ role: 'assistant', content: 'ok', state: 'complete' }),
  } as unknown as Response;
}) as typeof fetch;

async function main(): Promise<void> {
  const executor = new RemoteExecutor({
    serverUrl: 'https://example.invalid/api/v1/remote',
    userApiKey: 'test-key',
  });

  const controller = new AbortController();
  const request: IChatExecutionRequest = {
    provider: 'openai',
    model: 'gpt-4',
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'What is the weather?',
        state: 'complete',
        timestamp: new Date(),
      },
    ],
    tools: [
      {
        name: 'get_weather',
        description: 'Get the weather for a city',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    ],
    options: {
      model: 'gpt-4',
      tools: [
        {
          name: 'get_weather',
          description: 'Get the weather for a city',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ],
      toolChoice: 'required',
      maxTokens: 256,
      temperature: 0.2,
      effort: 'high',
      signal: controller.signal,
    },
  };

  await executor.executeChat(request);

  const sent = captured[0];
  const tools = sent?.body['tools'] as Array<{ name: string }> | undefined;
  const options = sent?.body['options'] as Record<string, unknown> | undefined;

  console.log('request url:', sent?.url);
  console.log('tools on the wire:', JSON.stringify(tools?.map((t) => t.name) ?? []));
  console.log('options on the wire:', JSON.stringify(options ?? null));
  console.log('fetch received a signal:', sent?.hadSignal);
  console.log(
    'unserializable members leaked:',
    JSON.stringify(
      ['signal', 'onTextDelta', 'onProviderNativeRawPayload'].filter(
        (k) => options && k in options,
      ),
    ),
  );

  const checks: Array<[string, boolean]> = [
    ["the agent's tool reached the wire", (tools ?? []).some((t) => t.name === 'get_weather')],
    ['toolChoice reached the wire', options?.['toolChoice'] === 'required'],
    ['maxTokens reached the wire', options?.['maxTokens'] === 256],
    ['temperature reached the wire', options?.['temperature'] === 0.2],
    ['effort reached the wire', options?.['effort'] === 'high'],
    ['the run signal reached fetch, so a remote call is cancellable', sent?.hadSignal === true],
    [
      'nothing unserializable leaked into the body',
      !!options && !('signal' in options) && !('onTextDelta' in options),
    ],
    [
      'options travel as ONE object, not parallel top-level fields',
      sent?.body['toolChoice'] === undefined,
    ],
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

### Scenario 2 — the server reads them

- Surface: the real `apps/agent-server` Express app, started by the scenario through the app's own
  composition root `createApp()` (it deploys as a Firebase Function and has no standalone listener).
  Nothing is mocked. The BYOK route is used because it takes the caller's key, so it needs no
  `JWT_SECRET` and no operator credential; it is the same handler shape and calls the same parser as
  the operator route, where the defect was identical.
- Expected observable result: `SCENARIO 2 PASS`, `EXIT:0` — an ill-typed option is answered `400`
  with the offending members named, a tool schema missing its description is likewise refused by
  name, and a well-formed request carrying tools and options passes validation and reaches the
  provider.
- Evidence: executed 2026-08-16 against the completed implementation; **EXIT:0**. Full output:

```text
server listening on 45044
ill-typed options → 400 {"error":"Invalid request options","rejected":["options.maxTokens: not a finite number","options.toolChoice: not auto | none | required | { tool: string }"]}
tool without a description → 400 {"error":"Invalid request options","rejected":["tools[0] (undescribed): missing a non-empty \"description\""]}
well-formed request → 500 {"error":"Chat request failed"}
PASS an ill-typed option is refused rather than ignored
PASS the refusal NAMES the misspelled toolChoice
PASS the refusal NAMES the ill-typed maxTokens
PASS a tool schema missing its description is refused
PASS the refusal names the offending tool and what it lacks
PASS a well-formed request with tools and options passes validation and reaches the provider
SCENARIO 2 PASS
```

The `500` on the well-formed request is the upstream OpenAI call failing with the obvious
non-credential the scenario supplies. It is recorded rather than asserted on, and it is itself the
evidence that validation passed and the provider was reached — before this change the same request
reached the provider with no tools and no options at all.

```ts
// scratch/src/core-044-s2.ts
/**
 * CORE-044 Scenario 2 — the far end of the seam: the real `apps/agent-server` Express app.
 *
 * Scenario 1 proved the client SENDS the tools and options. This proves the server READS them,
 * which is the half that was broken in a user-visible way: the handler destructured
 * `{ provider, messages, model }` and called `provider.chat(messages, { model })`, so a remote agent
 * configured with tools reached the model with none — silently, because a model that is never
 * offered a tool simply never calls one.
 *
 * `apps/agent-server` is deployed as a Firebase Function and has no standalone listener, so the
 * scenario starts the server by calling the app's own composition root, `createApp()`, and listening
 * on a local port. Nothing is stubbed or mocked: this is the same Express app the deployment serves.
 *
 * The BYOK route is used because it takes the caller's key rather than the operator's, so it needs
 * no `JWT_SECRET` and no operator credentials. It is the same handler shape and calls the same
 * option parser as the operator route — the defect was identical in both.
 *
 * The discriminating observations are offline and spend nothing: an ill-typed option must be REFUSED
 * and NAMED. Before the change the server never looked at `options`, so a correct one and a
 * misspelled one were treated identically — ignored.
 */
import { createApp } from '../../apps/agent-server/src/app';

import type { Server } from 'node:http';

const PORT = 45044;
const BYOK = `http://127.0.0.1:${PORT}/api/v1/byok/chat`;

const WELL_FORMED_TOOL = {
  name: 'get_weather',
  description: 'Get the weather for a city',
  parameters: { type: 'object', properties: { city: { type: 'string' } } },
};

async function post(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(BYOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: res.status, json };
}

function base(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    provider: 'openai',
    apiKey: 'sk-scenario-not-a-real-key',
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'hi' }],
    ...extra,
  };
}

async function main(): Promise<void> {
  const app = createApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(PORT, '127.0.0.1', () => resolve(s));
  });
  console.log('server listening on', PORT);

  try {
    const badOption = await post(base({ options: { toolChoice: 'requried', maxTokens: 'lots' } }));
    console.log('ill-typed options →', badOption.status, JSON.stringify(badOption.json));

    const badTool = await post(
      base({ tools: [{ name: 'undescribed', parameters: { type: 'object' } }] }),
    );
    console.log('tool without a description →', badTool.status, JSON.stringify(badTool.json));

    const wellFormed = await post(
      base({
        tools: [WELL_FORMED_TOOL],
        options: { toolChoice: 'required', maxTokens: 256, temperature: 0.2, effort: 'high' },
      }),
    );
    console.log(
      'well-formed request →',
      wellFormed.status,
      JSON.stringify(wellFormed.json).slice(0, 200),
    );

    const rejected = ((badOption.json['rejected'] as string[] | undefined) ?? []).join(' ');
    const toolRejected = ((badTool.json['rejected'] as string[] | undefined) ?? []).join(' ');

    const checks: Array<[string, boolean]> = [
      ['an ill-typed option is refused rather than ignored', badOption.status === 400],
      ['the refusal NAMES the misspelled toolChoice', rejected.includes('toolChoice')],
      ['the refusal NAMES the ill-typed maxTokens', rejected.includes('maxTokens')],
      ['a tool schema missing its description is refused', badTool.status === 400],
      [
        'the refusal names the offending tool and what it lacks',
        toolRejected.includes('undescribed') && toolRejected.includes('description'),
      ],
      [
        'a well-formed request with tools and options passes validation and reaches the provider',
        wellFormed.status !== 400,
      ],
    ];

    let failed = 0;
    for (const [label, ok] of checks) {
      console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
      if (!ok) failed += 1;
    }
    console.log(failed === 0 ? 'SCENARIO 2 PASS' : `SCENARIO 2 FAIL (${failed})`);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

void main();
```

## Implementation Outcome (2026-08-16)

### The tools drop, which was the user-facing one

`apps/agent-server/src/remote-chat-options.ts` now parses `tools` and `options` out of the request
body and both handlers forward them into `provider.chat`. A remote-executor agent's tools reach the
model. The body is anonymous network input on its way into a provider SDK, so every field is
validated rather than spread.

**A request whose recognised option is ill-typed is answered `400` with the reasons, not silently
partially applied.** That was a deliberate choice over the first draft, which forwarded what parsed
and returned the rest as a `rejectedOptions` note on a `200`: an ignored `toolChoice: 'requried'`
produces a plausible answer the caller never asked for, and that is indistinguishable from success —
the exact failure this item is about. Keys the schema does not recognise are ignored rather than
refused, because they carry no instruction and so cannot produce an unasked-for answer.

### The options drop, at the client end

`packages/agent-remote-client/src/client/wire-chat-options.ts` owns the `IChatOptions` → wire
projection. The options travel as ONE object under `options` rather than as parallel top-level
fields, so adding an option later is a change to that file rather than to the client body, the server
destructure and both of their tests.

`CHAT_OPTION_WIRE_DISPOSITION` is keyed by `keyof Required<IChatOptions>`, which makes adding a
member to that interface without deciding its fate a **compile error**, and a test pins that the only
members marked `local` are the three that genuinely cannot be serialized — a function or an
`AbortSignal`. That enumeration is the actual fix: the missing lines were a symptom, and what let
them stay missing was that nothing enumerated the contract.

### The streaming client, deleted rather than reconnected

`HttpClient.chatStream`, `SimpleRemoteExecutor.executeChatStream`, `chat-stream-http-method.ts` and
`createStreamTransportRequest` are removed, and the false claims in `apps/agent-server/src/app.ts`
and `apps/agent-server/docs/SPEC.md` are corrected.

Reasoning, since the item left the choice open. The route was never served under either spelling, so
every remote streaming call was a 404 — and the suite was green because the tests drove a mocked
`fetch`. Implementing the route instead would need a chunk assembler, and the one the client's own
comment referred to ("ExecutionService merges them") was deleted with the second execution engine in
CORE-042; building a wire protocol on a missing assembler risks silently corrupting tool calls, the
failure class that work existed to end. **Nothing works less than it did**: `IExecutor.executeChatStream`
is optional, so the remote provider now reports `supportsStreaming: false` and a caller gets an
accurate error rather than a 404, and since CORE-042 the turn drives streaming through `chat()` +
`onTextDelta` rather than `provider.chatStream`, so no product path lost a capability.

Restoring it is filed as **[CORE-046](CORE-046-remote-streaming-has-no-route-and-no-assembler.md)**,
which states the three decisions it actually needs.

### Also corrected

`packages/agent-core/src/interfaces/__tests__/run-options-audit.test.ts` cited `execution-stream.ts`
as a chat-option construction site for `temperature`, `maxTokens` and `toolChoice`, and
`robota-execution.ts` for the structured-output entries. CORE-042 falsified both citations — that file
builds no options and the structured half moved — so they are corrected here rather than left as
stale claims in an audit whose whole purpose is to name where an option is consumed.

### Verification

- `apps/agent-server` 45 tests, `packages/agent-remote-client` 102 tests, both scopes green under
  `pnpm harness:verify`.
- `pnpm build` clean; every workspace package's suite passes except `dag-adapters-sqlite` and
  `dag-worker`, which fail locally on a missing `better-sqlite3` native binding — an environment
  fault outside this change's file set.
- Red-proof recorded for both halves: reverting the server parser to `{ model }` fails 6 of the 8
  option cases including the tools one; removing `options` from the request body fails the client's
  body assertion.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-16

**Status upgrade:** in-progress → done

- Both scenarios were executed by the agent against the completed implementation, each with `EXIT:0`
  and its full output recorded under the scenario above.
- The observed result matched the expected observable result for both.
- Evidence references durable repository artifacts:
  `apps/agent-server/src/__tests__/remote-chat-options.test.ts`,
  `packages/agent-remote-client/src/client/__tests__/wire-chat-options.test.ts`, and the scenario
  blocks inlined above (`scratch/src` is gitignored).
- No engineering verification is cited as user-execution evidence — the suites are recorded
  separately under _Verification_.
- No capability-absence claim is made: the credential probe is recorded, and neither scenario needed
  a credential anyway.
