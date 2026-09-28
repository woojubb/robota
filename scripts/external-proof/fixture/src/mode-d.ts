/**
 * MODE D — Roundtable: independent participants in a shared conversation, and a Robota-backed
 * adapter turn, from OUTSIDE the monorepo, against the published `.d.ts` surface only.
 *
 * Two claims, matching issue #3273 section 9's acceptance criteria for external-consumer validation:
 *
 * D1 — a two-participant PARALLEL conversation, built with the in-memory store and two hand-written
 * ("custom") participants, proves genuine overlap with a barrier the TEST itself waits on: both
 * calls must have started before either can proceed, so the test observes overlap directly instead
 * of guessing from timing. It then resolves the SECOND-selected participant ("beta") first and waits
 * for beta's own `prepared` event — proof its result was saved — while alpha is still blocked, and
 * only then asserts nothing has published yet and that publication ultimately follows the SELECTOR's
 * order (alpha, beta), not completion order (beta settled first).
 *
 * D2 — a `robotaParticipant` from `@robota-sdk/agent-roundtable-robota` runs a plain `Robota` agent,
 * using `@robota-sdk/agent-core`'s own published scripted/test provider (`createScriptedProvider` from
 * the `/testing` subpath) instead of a hand-rolled mock. Asserts one published speak turn reached the
 * shared transcript and one usage record was recorded and settled for it.
 */

import { Robota } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import {
  createRoundtable,
  MemoryConversationStore,
  type AgentParticipant,
  type ParticipantOutcome,
  type SelectionContext,
} from '@robota-sdk/agent-roundtable';
import { robotaParticipant } from '@robota-sdk/agent-roundtable-robota';

import { check, checkEqual, mode, note, section } from './harness.js';

/**
 * A regression to serial execution (or to publishing before the whole group is prepared) would hang
 * one of the awaits below forever instead of failing. This bounds every such wait so the proof fails
 * loudly instead of hanging the whole external-proof run.
 */
const IN_FLIGHT_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), IN_FLIGHT_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Resolves once `expected` callers have all called `arrive()`; each caller then awaits together. */
function makeBarrier(expected: number) {
  let arrivals = 0;
  let releaseAll!: () => void;
  const everyoneArrived = new Promise<void>((resolve) => {
    releaseAll = resolve;
  });
  return {
    /** Resolves once every expected caller has arrived — proof they were genuinely in flight together. */
    everyoneArrived,
    async arrive(): Promise<void> {
      arrivals += 1;
      if (arrivals === expected) releaseAll();
      await everyoneArrived;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** A hand-written participant — no Robota, no Session, nothing from this repo but the core contract. */
function customParticipant(
  id: string,
  reply: Promise<string>,
  barrier: ReturnType<typeof makeBarrier>,
): AgentParticipant {
  return {
    kind: 'agent',
    id,
    runtime: { id: `external-proof/${id}`, version: '1' },
    factory: {
      openSession: async () => ({
        session: {
          runTurn: async (): Promise<ParticipantOutcome> => {
            await barrier.arrive(); // Blocks until every selected participant has started.
            const content = await reply;
            return { kind: 'speak', content };
          },
        },
        release: async () => {},
      }),
    },
  };
}

async function runParallelBarrier(): Promise<void> {
  section('D1 — two custom participants run in parallel: a barrier proves genuine overlap');

  const barrier = makeBarrier(2);
  const alphaReply = deferred<string>();
  const betaReply = deferred<string>();
  const alpha = customParticipant('alpha', alphaReply.promise, barrier);
  const beta = customParticipant('beta', betaReply.promise, barrier);
  const betaPrepared = deferred<void>();

  const room = createRoundtable({
    conversationId: 'external-proof-parallel',
    participants: [alpha, beta],
    store: new MemoryConversationStore(),
    maxConcurrentParticipants: 2,
    // 2 attempts are reserved for the parallel group itself (one per participant); one more lets
    // the run call select() again afterward and reach 'finish' rather than stopping on the limit.
    limits: { maxTurnsPerRun: 3 },
    selector: {
      select: (view: SelectionContext) =>
        view.turns.length === 0
          ? { kind: 'parallel' as const, participantIds: ['alpha', 'beta'] }
          : { kind: 'finish' as const, reason: 'external-proof' },
    },
    onEvent: (event) => {
      if (event.type === 'prepared' && event.participantId === 'beta') betaPrepared.resolve();
    },
  });

  const running = room.run();

  // Wait until BOTH runTurn() calls have actually started and reached the barrier. This is the
  // barrier's own promise, not a guess based on microtask timing: it can only resolve once alpha AND
  // beta have both called arrive(), so the test is observing genuine overlap directly. A regression
  // to serial execution (running alpha to completion before starting beta) would leave this pending
  // forever, and the timeout below turns that hang into a failure.
  await withTimeout(
    barrier.everyoneArrived,
    'both participants never became in flight together — regression to serial execution?',
  );

  // Resolve the SECOND-selected participant ("beta") first, then wait for BETA'S OWN "prepared"
  // event — proof its result was saved — while alpha is still blocked on its own reply. Only once
  // that is true does the "nothing published yet" check below actually exercise the claim it makes:
  // that the group withholds publication until every member is ready, not just "immediately after
  // calling run()", which would pass trivially in a broken implementation too.
  betaReply.resolve('beta-reply');
  await withTimeout(
    betaPrepared.promise,
    'beta never reached "prepared" after its reply resolved — did runTurn() actually run?',
  );
  checkEqual(
    'nothing publishes while alpha (selected first) is still in flight',
    room.snapshot().messages.length,
    0,
  );

  // Now resolve ALPHA and let the group publish.
  alphaReply.resolve('alpha-reply');
  const result = await withTimeout(running, 'the parallel run never completed');

  checkEqual('the parallel run completed', result.status, 'completed');
  checkEqual(
    'publication order is the SELECTOR order (alpha, beta), not completion order (beta settled first)',
    room.snapshot().messages.map((message) => ({
      participantId: message.participantId,
      content: message.content,
    })),
    [
      { participantId: 'alpha', content: 'alpha-reply' },
      { participantId: 'beta', content: 'beta-reply' },
    ],
  );
  await room.dispose();
  note(
    'the barrier proves both calls were genuinely in flight together; beta settling and reaching ' +
      '"prepared" well before alpha, with nothing published in between, proves the group withholds ' +
      'publication until every member is ready and then orders it by selection (alpha, beta) rather ' +
      'than by which participant finished first (beta)',
  );
}

async function runRobotaAdapterTurn(): Promise<void> {
  section("D2 — a robotaParticipant speaks, metered through the adapter's own usage ledger");

  // NOTE: this scripted turn's `usage` counts are never metered — see the note below. Declared here
  // only so the scripted provider's own request/response shape matches a real one; the assertions
  // below check what the ledger actually records, not these counts.
  const scripted = createScriptedProvider([{ text: 'adapter reply' }]);

  const assistant = robotaParticipant({
    id: 'assistant',
    runtime: { id: 'external-proof/assistant', version: '1' },
    createAgent: async () =>
      new Robota({
        name: 'assistant',
        aiProviders: [scripted.provider],
        defaultModel: { provider: scripted.provider.name, model: 'scripted-model' },
      }),
  });

  const publishedMessages: { participantId: string; content: string }[] = [];
  const room = createRoundtable({
    conversationId: 'external-proof-adapter',
    participants: [assistant],
    store: new MemoryConversationStore(),
    limits: { maxTurnsPerRun: 1 },
    onEvent: (event) => {
      if (event.type === 'published') {
        for (const message of event.messages) {
          publishedMessages.push({
            participantId: message.participantId,
            content: message.content,
          });
        }
      }
    },
  });

  const result = await room.run();
  check(
    'the adapter turn reached a terminal or per-run-limited result',
    result.status === 'completed' || result.status === 'limited',
    result.status,
  );
  checkEqual('exactly one speak turn published through the adapter', publishedMessages.length, 1);
  check(
    "the published content is the scripted provider's own reply",
    publishedMessages[0]?.content === 'adapter reply',
  );
  check(
    'the scripted provider actually received exactly one chat() call',
    scripted.requests.length === 1,
  );

  const usageRecords = room.snapshot().usage;
  const assistantRecord = usageRecords.find(
    (record) => record.principal.kind === 'participant' && record.principal.id === 'assistant',
  );
  check('a usage record was recorded for the assistant participant', assistantRecord !== undefined);
  check(
    'that usage record settled (not just reserved) for the adapter turn',
    assistantRecord?.status === 'settled',
  );

  await room.dispose();
  note(
    'usage flows assistant.run() -> the executionJournal agent-core calls -> meterJournal ' +
      "(agent-roundtable-robota) -> TurnServices.recordUsage -> the conversation's own usage ledger, " +
      'entirely through public exports of the two packed packages. The scripted provider here never ' +
      'sets the `usageProvenance` metadata marker a real provider adapter attests, so the ledger ' +
      "settles this call with provenance 'unknown' and no token counts — that is what is actually " +
      'metered from a provider that never attests its own usage, not the scripted numbers a script ' +
      'happens to declare.',
  );
}

export async function runModeD(): Promise<void> {
  mode('MODE D — Roundtable: independent participants, and a Robota-backed adapter turn');
  await runParallelBarrier();
  await runRobotaAdapterTurn();
}
