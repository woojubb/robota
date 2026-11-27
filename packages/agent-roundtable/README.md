# @robota-sdk/agent-roundtable

Coordinates independent agents and people in one shared conversation. Each participant keeps its own
runtime and private state; the roundtable decides who speaks next, runs a turn or a parallel group of
turns, and publishes their messages to a shared transcript in a stable order. The host supplies the
participants, the selector that picks the next turn, optionally the context policy that shapes what
each participant is shown, and the store that holds conversation progress.
The package runs no model and imports no provider: a participant can wrap an agent session, another
agent runtime, or plain code.

## Installation

```bash
npm install @robota-sdk/agent-roundtable
```

## Quick start

```typescript
import {
  createRoundtable,
  externalParticipant,
  MemoryConversationStore,
  type AgentParticipant,
} from '@robota-sdk/agent-roundtable';

// A participant opens one session per conversation. This one repeats the newest message it sees.
const echo: AgentParticipant = {
  kind: 'agent',
  id: 'echo',
  runtime: { id: 'example/echo', version: '1' },
  factory: {
    openSession: async () => ({
      session: {
        runTurn: async (turn) => {
          const latest = turn.context.messages.at(-1)?.content ?? 'nothing yet';
          return { kind: 'speak', content: `echo: ${latest}` };
        },
      },
      release: async () => {},
    }),
  },
};

export async function runQuickstart() {
  const published: string[] = [];
  const room = createRoundtable({
    conversationId: 'demo',
    participants: [externalParticipant({ id: 'user' }), echo],
    store: new MemoryConversationStore(),
    limits: { maxTurnsPerRun: 1 },
    onEvent: (event) => {
      if (event.type === 'published')
        for (const message of event.messages)
          published.push(`${message.participantId}: ${message.content}`);
    },
  });

  // The default round-robin selector asks the person first, so the run waits for input.
  const waiting = await room.run();
  if (waiting.status === 'waiting') {
    await room.submitInput({
      participantId: 'user',
      inputId: 'input-1', // Retrying with the same id and content returns the same receipt.
      expectedRevision: waiting.revision,
      replyToRequestId: waiting.requests[0].id,
      content: 'Hello',
    });
  }

  const result = await room.run(); // echo speaks: { status: 'limited', reason: 'turns', ... }
  const messages = room.snapshot().messages.map((message) => message.content); // ['Hello', 'echo: Hello']
  await room.dispose();
  return { result, messages, published };
}

await runQuickstart();
```

This exact example is executed by `src/readme-example.test.ts`, so it stays runnable as the package
changes.

Omitting `store` uses the same in-memory store. A durable `ConversationStore` together with a
`RoundtableRegistry` that maps saved runtime, selector and context policy versions back to live
objects lets `loadRoundtable` reopen a conversation later.

## Exports

| Export                      | What it is for                                                                                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createRoundtable(options)` | Validates configuration and returns a `Roundtable` handle; `run()` executes it.                                                                                                                                                                                                                         |
| `loadRoundtable(options)`   | Reopens a conversation from a `ConversationStore`, resolving saved runtime, selector and context policy references through a `RoundtableRegistry`.                                                                                                                                                      |
| `MemoryConversationStore`   | The in-memory `ConversationStore`; no durability, no `recovery: 'durable'` support.                                                                                                                                                                                                                     |
| `externalParticipant(def)`  | Declares a participant answered through `submitInput`/`resume` instead of a factory.                                                                                                                                                                                                                    |
| `increments()`              | The default `ContextPolicy`: no model calls; a participant is offered every message it has not seen and did not write (see "Context policy").                                                                                                                                                           |
| `roundRobin()`              | The default `TurnSelector`: no model calls; cycles through participants in order after the last speaker, forever — it never finishes on its own, so a run's own limits (`maxTurnsPerRun`, `timeoutMs`, a model-call limit) are what stop it.                                                            |
| `RoundtableError`           | Thrown by every rejecting call and by `TurnServices.admitModelCall` and `admitToolEffect`; `code` is `invalid-config`, `busy`, `conflict`, `disposed`, `stale-claim`, `recovery-required`, `model-call-limit`, `budget-limit`, `call-settled`, `invalid-selection` or `invalid-context` (see "Errors"). |
| `summarizeUsage(records)`   | Reduces `UsageRecord[]` (from a snapshot or the `usage` event) into one combined `UsageSummary`, counting tool effects (`toolEffects`) apart from model calls and calls recovery refunded (`notDispatchedCalls`); filter the records first (by run, participant, ...) for a per-principal breakdown.    |

Everything else this package exports is a type: the participant/session/selector contracts
(`ParticipantDefinition`, `ParticipantSession`, `TurnSelector`, …), the store contract
(`ConversationStore`, `ConversationEnvelope`, …), and the usage/pricing types consumed by
`TurnServices`. `@robota-sdk/agent-roundtable-robota` implements these contracts against agent runtime; a
host can implement them against any other runtime.

## Checking a custom conversation store

Backend authors can run the runner-independent storage checks through the separate testing entry:

```typescript
import { MemoryConversationStore } from '@robota-sdk/agent-roundtable';
import { runConversationStoreConformance } from '@robota-sdk/agent-roundtable/testing';

await runConversationStoreConformance((_caseName) => {
  let now = 1_000;
  const backend = new MemoryConversationStore({ now: () => now });
  return {
    clients: [backend, backend], // Replace with two clients sharing one isolated backend namespace.
    leaseMs: 1_000,
    advanceTo: (unixMilliseconds) => {
      now = Math.max(now, unixMilliseconds);
    },
    cleanup: () => {},
  };
});
```

The factory runs once per named scenario with fresh storage. For a database, return independently
constructed clients that share that scenario's namespace. `advanceTo` must await authoritative backend
time reaching the requested UTC Unix millisecond boundary; use a controllable test clock or bounded
waits on a disposable backend. Choose a lease with enough margin for backend calls (at least 2ms).
Lease checks always run. The host test runner supplies its own timeout and must cancel or drain hung
backend work before removing its namespace. The helper awaits `cleanup` in `finally` after each
created fixture and fails fast with the scenario name. A cleanup failure also fails the run.

The checks cover opaque JSON snapshots and clone isolation, shared-storage creation and revision
races, lease renewal and fencing, release races, operation fingerprints, retained original receipts,
and lost-reply lookup/retry. A matching known operation must return its original receipt even after
later writes or ownership changes; an old caller expiry alone does not invalidate a renewed fence.
No test runner, provider, Node built-in, or runtime dependency is imported by this entry. The main
package entry does not import the helper.

A store that declares `durability: 'durable'` also runs `runDurableConversationStoreConformance`, which
accepts the same fixture plus `restart()`, returning a new client over the same storage (a client it
restarted from is never reused). After each restart the suite requires the store to still declare
`'durable'`, to return every committed envelope and receipt (a retried commit whose reply was lost
returns the original receipt and creates no revision), to keep an unreleased claim `busy` until expiry and
then issue a higher fence while refusing the old claim, and to show nothing of a rejected write.

Passing either suite checks these storage behaviors under the supplied test clock. It does not establish
durability across process death or a crash beyond what the fixture's `restart()` exercises (a new client
over shared storage in the same process does not), production clock bounds, multi-region consistency, or
exactly-once external effects, and it does not enable `recovery: 'durable'` for Roundtable execution.

## Run results

`run()` advances until one of these results:

| Status      | Meaning                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| `waiting`   | Requests need answers: `submitInput` answers input, `resume` answers any request.                         |
| `limited`   | This run reached `maxTurnsPerRun`, `timeoutMs`, a model-call limit or the budget; the next run continues. |
| `cancelled` | The `signal` fired or `dispose()` was called; the next run or a loaded handle continues.                  |
| `completed` | The selector finished the conversation. Every later `run()` returns the same result.                      |
| `failed`    | A participant, the selector or the store failed. Every later `run()` returns the same result.             |

## Events

`onEvent` observes progress and is awaited, but it never decides it:

- `group-started` — the selected participants and the transcript revision they all see.
- `delta` — text a participant streams through `onDelta` while its turn runs.
- `prepared` — a participant's result is saved but not public yet.
- `usage` — a model-call admission or usage report was saved to the usage ledger; a report that
  settles after the run that admitted its call has already stopped is saved silently, with no event.
- `published` — the whole group committed; its messages are in the transcript, in selection order.

An exception from `onEvent` goes to `onEventError` and cannot undo a committed group.

## Context policy

A participant's turn is shown a view of the messages it has not consumed and did not write. The
default, `increments()`, offers all of them. A host passes `contextPolicy` to change that: its
`assemble({ recipient, undelivered, purpose })` returns the `messages` to offer (a subset of
`undelivered`, each unchanged and listed once), an optional `summary`, and the ids it `consumed`
without offering. An undelivered message in neither list is deferred and offered to that participant
on a later turn; a consumed one is never offered again, and the `summary` (non-empty text of at most
32768 characters) is what stands in for it. Both appear in `turn.context`, and the participant's
delivery cursor records exactly the messages offered plus the ids consumed.

```typescript
const newestOnly: ContextPolicy = {
  reference: { id: 'host/newest-only', version: '1' },
  modelCalls: 'none',
  assemble: ({ undelivered }) => {
    const skipped = undelivered.slice(0, -1);
    return {
      messages: undelivered.slice(-1),
      ...(skipped.length ? { summary: `${skipped.length} earlier messages were skipped.` } : {}),
      consumed: skipped.map((message) => message.id),
    };
  },
};
```

A policy must be a function of its input alone and declare no model calls (`modelCalls` is `'none'` or
omitted); a model-backed summarizer is a metered caller and is rejected at construction. Its
`reference` is saved with the conversation, so `loadRoundtable` needs a registry whose
`resolveContextPolicy(reference)` returns a policy with the same reference; the built-in `increments()`
resolves without one, and a missing resolver or a different reference is refused with `invalid-config`
before any session opens. The assembled view is stored with the turn, so a loaded conversation never
asks the policy again for a turn it already assembled. A selector's own view is not shaped by the
policy: it is shown the whole transcript.

## Budget

`budget: { tokens?, cost?, mode? }` puts a ceiling over the whole conversation: a positive token amount,
a `cost` (`{ currency, minorUnits }` with a positive integer amount), or both. Tokens count
`input + output` (cache and reasoning counts are parts of those, so a reporter folds them into `input`).
A cost amount needs `pricing`, and a strict one needs `pricing.bound(call)`, which returns the most a
call can cost given its declared bound (or `null` when it cannot be priced). The amounts are saved with
the conversation, so `loadRoundtable` takes no `budget`: the saved one governs, and a different one is
not accepted.

Every agent factory and the selector must declare `modelCalls` as `'none'` or `'enforced'`, where
`'enforced'` means the caller also passes a `bound: { inputTokens, maxOutputTokens }` with each
`admitModelCall`. A merely `'metered'` or undeclared caller is refused at construction with
`invalid-config`, as is any amount or mode no admission could satisfy. A `'none'` declaration is the
caller's own word, so spend by such a caller is outside the budget.

Admission sets the bound aside before the call is dispatched and is refused with `budget-limit` unless
it fits beside everything already spent or reserved; filling the budget exactly is admitted and one
unit over is not. A report that fully shows a call's usage (a final `completed` or `cache-hit` report
with `reported` or `estimated` provenance, carrying `input` and `output` tokens for a token budget and a
price for a cost budget) replaces the bound with the actual usage. A call that is cancelled, failed,
partial, unreported or otherwise not fully known keeps its bound counted, raised to anything its
report proves, because a refund on a guess could let the budget be overspent. A bound set too low
can still overspend once, after which admissions stop.

`mode: 'estimated'` takes an `estimator: { estimate(call) }` and lets a call that declares no bound
borrow the estimator's (`{ bound?, cost? }`, returned synchronously). Its reservation is recorded with
provenance `'estimated'`; a strict budget, the default, refuses a call without a bound.

A host settles a call whose usage never arrived with `room.reconcileUsage({ callId, tokens, cost? })`,
which replaces its retained bound with the amounts given. Only the handle has it, never the
`TurnServices` a participant receives, so a participant cannot refund itself. The same amounts again
change nothing; different amounts, an unknown call, a call that was never admitted or one whose usage
is already fully known are a `conflict`. It never changes a call count or a record's status, advances
the revision, is refused while a run, input or resume is active, and a reconciled call accepts no
further report.

Recovery answers a reserved call of an interrupted attempt one way. A call it proved never dispatched
is stored with the outcome `'not-dispatched'`, which no participant can report: it charges nothing, so
exactly what admission set aside is released, yet it still counts against every call limit it was
admitted under. A call the journal shows was settled takes that final report through the ordinary
settle path, and an uncertain one keeps its bound until `reconcileUsage`. Each call is settled once,
for its own principal and attempt; an answer naming a call that is already settled is refused with `call-settled`.

A participant whose tool spends money or tokens of its own declares each effect before it starts with
`services.admitToolEffect({ callId, toolName, tokens })`, where `tokens` is the most it can spend in the
budget's token unit. The effect is admitted like a model call under the same rules (`budget-limit` when
it does not fit, an idempotent retry per call id, a conflict on a changed bound), is recorded with
`kind: 'tool-effect'`, provider `'tool'` and the tool name as the model, and is settled through
`recordUsage` and `reconcileUsage` like any call; a cache hit cannot be reported for it. A cost budget
prices it through `pricing.bound`, which also receives the call's `kind`, and refuses an effect that
cannot be priced. A tool effect counts against the budget but never against a model-call limit, and
`summarizeUsage` counts it under `toolEffects`, leaving `totalCalls` and the other call counters to
model calls while tokens and cost include both.

A run stops with `limited` and reason `'budget'` instead of dispatching a selector or a group once any
amount is fully spent (a call-count limit is checked first). A group is refused whole,
and one made only of `'none'` members still runs. A remainder smaller than every call's bound ends each
run `limited` without dispatching.

## Errors

Calls reject with a `RoundtableError` whose `code` is one of `invalid-config`, `busy` (a `run`,
`submitInput` or `resume` is already active, or another owner holds the stored conversation),
`conflict` (a stale `expectedRevision`, a reused id with different content, or a request that is no
longer pending), `disposed`, `stale-claim` (this handle's claim on the store expired or changed
owner), `recovery-required` or `call-settled` (the call a recovery answer names was already settled, by recovery or by a report).

`model-call-limit` and `budget-limit` are different: they are thrown by `TurnServices.admitModelCall` or `admitToolEffect`
itself, to whichever custom participant, selector or `meterJournal` (from `@robota-sdk/agent-roundtable-robota`) host called it, once a configured `maxModelCallsPerRun`,
`-PerConversation` or `-PerParticipant` limit is reached (`model-call-limit`) or a call's bound no
longer fits the budget (`budget-limit`). Admission has already stopped the run, which ends `limited`
(reason `'model-calls'` or `'budget'`) either way. The caller should still let the rejection
propagate (or return `failed`): the interrupted attempt is then discarded and retried on a later run,
whereas swallowing it and returning `speak` keeps that partial result and publishes it later.

`invalid-context` never reaches a caller as a rejection either: it is thrown internally when a context
policy throws, or returns a message that was not undelivered or is listed twice, an unknown or repeated
consumed id, a message that is also consumed, or a summary that is empty, too long or not text. The
group is never started and the run ends `failed` with the error's message.

`invalid-selection` never reaches a caller as a rejection: it is thrown internally when a selector's
decision is malformed, empty, or has duplicate participant ids, names an unknown participant, mixes
kinds a group can't run (a non-agent in a `parallel` selection, or a non-external participant for a
`wait`), or needs more turns than `maxTurnsPerRun` allows — and the run's own error handling catches
it like any other participant/selector/store failure. The decision is never saved, and the run ends
`failed`, with the `RoundtableError`'s message (not its `code`) surfaced as the `message` of the `failed` `RunResult`.

## Cancellation

Passing a `signal` to `run()`, a `timeoutMs` limit, a model-call limit or budget that rejects an admission and
`dispose()` stop new turns and wait for running participants to settle; they end the run, not the
conversation. A result a participant returned is kept, even one that arrives after the abort, and is
published when its group completes on a later run. An attempt stopped without one, for example a
`runTurn` that rejects with the signal's reason, runs again on the next run for the same turn with a
new `attemptId`. When the participant provides `checkpoint()`, its session is released and the retry
opens a new one from the last saved checkpoint, as loading would, so private state never holds the
abandoned attempt. A participant without checkpoints keeps its live session (a new one only before its
first turn), so its private state may retain the abandoned attempt; retry-independent private state
requires `checkpoint()`. If the attempt already acted outside the conversation, the participant's
runtime must report that. `run()` and `loadRoundtable` reject with `recovery-required` only when stored
state holds a turn that was never seen to settle, such as after the process stopped mid-turn. A group
with a failed member is never published or run again automatically.

## Supported environments

The build is platform-neutral ESM and CommonJS with type declarations and has no runtime
dependencies. It needs only standard globals: `AbortController`, `AbortSignal.any`,
`structuredClone`, `crypto.randomUUID` and `setTimeout`. That covers Node.js 22.12 or later and
current browsers.

A participant can be a plain object like `echo` above, or come from
`@robota-sdk/agent-roundtable-robota`'s `sessionParticipant` (a permission-gated agent runtime `Session`) or
`runtimeParticipant` (a plain agent) — this package never depends on either.

## Version and compatibility

This package's own API follows semantic versioning. That is separate from the **stored
conversation schema**: `MemoryConversationStore` and any other `ConversationStore` persist a snapshot
whose envelope carries `schemaVersion: 1`, and it keeps that envelope exactly as given — a store never
inspects or validates it; decoding is the conversation owner's job. `loadRoundtable` is what decodes a
loaded envelope, and it rejects (rather than guesses at) one whose `schemaVersion` it does not
recognize, with a `RoundtableError('invalid-config', ...)`; so a schema change ships as a new number
and an explicit migration, never a silent reinterpretation — independent of how many API-compatible
minor/patch releases happen in between. `loadRoundtable` additionally requires the saved
participant/selector runtime, context policy and configuration versions to match what a
`RoundtableRegistry` resolves today; a mismatch is refused the same way, rather than run against the wrong definition.

## Documentation

- [docs/SPEC.md](docs/SPEC.md) — purpose, contract, invariants and non-goals.
