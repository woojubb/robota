/**
 * MODE D — Roundtable: independent participants in a shared conversation, and a Robota-backed
 * adapter turn, from OUTSIDE the monorepo, against the published `.d.ts` surface only.
 *
 * Two claims, matching issue #3273 section 9's acceptance criteria for external-consumer validation:
 *
 * D1 — a two-participant PARALLEL conversation, built with the in-memory store and two hand-written
 * ("custom") participants, proves genuine overlap with a barrier: neither participant's call can
 * resolve until BOTH have started, so if the run ever completes, both calls were in flight together.
 * It also asserts publication order follows the SELECTOR's order, not completion timing (the SPEC's
 * own claim), by resolving the two calls in the opposite order from how they were selected.
 *
 * D2 — a `robotaParticipant` from `@robota-sdk/agent-roundtable-robota` runs a plain `Robota` agent,
 * using `@robota-sdk/agent-core`'s own published scripted/test provider (`createScriptedProvider` from
 * the `/testing` subpath) instead of a hand-rolled mock. Asserts one published speak turn reached the
 * shared transcript and one usage record was recorded for it.
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

/** Resolves once `expected` callers have all called `arrive()`; each caller then awaits together. */
function makeBarrier(expected: number) {
  let arrivals = 0;
  let releaseAll!: () => void;
  const everyoneArrived = new Promise<void>((resolve) => {
    releaseAll = resolve;
  });
  return {
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
function customParticipant(id: string, reply: Promise<string>, barrier: ReturnType<typeof makeBarrier>): AgentParticipant {
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
  });

  const running = room.run();
  // Neither runTurn() can return until barrier.arrive() releases both — which happens only once
  // BOTH have called it. If this hangs, the two calls did not genuinely overlap.
  // Resolve the SECOND-selected participant ("beta") first, so a publication order that merely
  // followed completion timing would come out wrong.
  betaReply.resolve('beta-reply');
  await Promise.resolve();
  checkEqual(
    'nothing publishes while the group is still in flight',
    room.snapshot().messages.length,
    0,
  );
  alphaReply.resolve('alpha-reply');
  const result = await running;

  checkEqual('the parallel run completed', result.status, 'completed');
  checkEqual(
    'publication order is the SELECTOR order (alpha, beta), not completion order',
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
    'the barrier inside each custom participant only releases once BOTH calls have started — the ' +
      'run reaching "completed" is only possible because both were in flight together, not because ' +
      'one call returned before the other started',
  );
}

async function runRobotaAdapterTurn(): Promise<void> {
  section("D2 — a robotaParticipant speaks, metered through the adapter's own usage ledger");

  const scripted = createScriptedProvider([
    { text: 'adapter reply', usage: { inputTokens: 11, outputTokens: 7 } },
  ]);

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
          publishedMessages.push({ participantId: message.participantId, content: message.content });
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
    'the published content is the scripted provider\'s own reply',
    publishedMessages[0]?.content === 'adapter reply',
  );
  check(
    'the scripted provider actually received exactly one chat() call',
    scripted.requests.length === 1,
  );

  const usageRecords = room.snapshot().usage;
  check('at least one usage record was recorded for the adapter turn', usageRecords.length > 0);
  check(
    'the usage record is attributed to the assistant participant',
    usageRecords.some(
      (record) => record.principal.kind === 'participant' && record.principal.id === 'assistant',
    ),
  );

  await room.dispose();
  note(
    'usage flows assistant.run() -> the executionJournal agent-core calls -> meterJournal ' +
      '(agent-roundtable-robota) -> TurnServices.recordUsage -> the conversation\'s own usage ledger, ' +
      'entirely through public exports of the two packed packages',
  );
}

export async function runModeD(): Promise<void> {
  mode('MODE D — Roundtable: independent participants, and a Robota-backed adapter turn');
  await runParallelBarrier();
  await runRobotaAdapterTurn();
}
