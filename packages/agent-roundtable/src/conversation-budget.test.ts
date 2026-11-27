import { describe, expect, it, vi } from 'vitest';
import {
  createRoundtable,
  loadRoundtable,
  MemoryConversationStore,
  summarizeUsage,
  type AgentParticipant,
  type LoadRoundtableOptions,
  type ModelCallBound,
  type ParticipantExecutionOptions,
  type ParticipantFactory,
  type ParticipantOutcome,
  type ParticipantTurn,
  type PricePolicy,
  type RoundtableOptions,
  type Roundtable,
  type TurnServices,
  type UsageReport,
} from './index';

const bound = (inputTokens: number, maxOutputTokens = 0): ModelCallBound => ({
  inputTokens,
  maxOutputTokens,
});
const usd = (minorUnits: number | string) => ({ currency: 'USD', minorUnits: String(minorUnits) });
const admit = (services: TurnServices, callId: string, callBound?: ModelCallBound) =>
  services.admitModelCall({
    callId,
    providerId: 'p',
    modelId: 'm',
    ...(callBound ? { bound: callBound } : {}),
  });

type Run = (
  turn: ParticipantTurn,
  options: ParticipantExecutionOptions,
) => Promise<ParticipantOutcome>;

function enforced(id: string, run: Run): AgentParticipant {
  return {
    kind: 'agent',
    id,
    runtime: { id: 'test', version: '1' },
    factory: {
      modelCalls: 'enforced',
      openSession: async () => ({
        session: { runTurn: run },
        release: async () => {},
      }),
    },
  };
}

const speak = (content = 'ok'): ParticipantOutcome => ({ kind: 'speak', content });

/** Prices a call at one minor unit per token, so a bound and a report cost what they count. */
const perToken: PricePolicy = {
  version: 'per-token',
  cost: (record) =>
    record.status === 'settled' && record.tokens
      ? usd((record.tokens.input ?? 0) + (record.tokens.output ?? 0))
      : null,
  bound: (call) => usd(call.bound.inputTokens + call.bound.maxOutputTokens),
};

/** One enforced participant that runs `script` once with its services, in a one-turn run. */
async function scripted(
  extra: Partial<RoundtableOptions>,
  script: (services: TurnServices, room: () => Roundtable) => Promise<void>,
) {
  let room!: Roundtable;
  room = createRoundtable({
    conversationId: crypto.randomUUID(),
    participants: [
      enforced('a', async (_turn, options) => {
        await script(options.services, () => room);
        return speak();
      }),
    ],
    limits: { maxTurnsPerRun: 1 },
    ...extra,
  });
  const result = await room.run();
  return { room, result };
}

const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error) => error,
  );

describe('a token budget admits a call only while its bound fits beside what is spent or reserved', () => {
  it('admits a call whose bound exactly fills the budget and refuses one token more', async () => {
    const errors: unknown[] = [];
    const { room, result } = await scripted({ budget: { tokens: 100 } }, async (services) => {
      await admit(services, 'fits', bound(60, 40));
      errors.push(await rejection(admit(services, 'over', bound(1))));
    });
    expect(errors).toEqual([expect.objectContaining({ code: 'budget-limit' })]);
    expect(result).toMatchObject({ status: 'limited', reason: 'budget' });
    expect(room.snapshot().usage.map((record) => record.callId)).toEqual(['fits']);

    const refused: unknown[] = [];
    const empty = await scripted({ budget: { tokens: 100 } }, async (services) => {
      refused.push(await rejection(admit(services, 'big', bound(60, 41))));
    });
    expect(refused).toEqual([expect.objectContaining({ code: 'budget-limit' })]);
    expect(empty.room.snapshot().usage).toEqual([]);
  });

  it('counts reservations that no report has settled yet', async () => {
    const errors: unknown[] = [];
    const { room } = await scripted({ budget: { tokens: 100 } }, async (services) => {
      await admit(services, 'first', bound(60));
      errors.push(await rejection(admit(services, 'third', bound(40))));
      errors.push(await rejection(admit(services, 'second', bound(1))));
    });
    expect(errors).toEqual([undefined, expect.objectContaining({ code: 'budget-limit' })]);
    expect(room.snapshot().usage).toHaveLength(2);
  });

  it('replaces the reservation with the actual usage when a report fully shows it', async () => {
    const errors: unknown[] = [];
    const { room } = await scripted({ budget: { tokens: 100 } }, async (services) => {
      await admit(services, 'first', bound(60, 40));
      await services.recordUsage({
        callId: 'first',
        outcome: 'completed',
        provenance: 'reported',
        tokens: { input: 10, output: 5 },
        final: true,
      });
      errors.push(await rejection(admit(services, 'fits', bound(85))));
      errors.push(await rejection(admit(services, 'over', bound(1))));
    });
    expect(errors).toEqual([undefined, expect.objectContaining({ code: 'budget-limit' })]);
    // The reservation stays as admitted; only what the record counts changed.
    expect(room.snapshot().usage[0]).toMatchObject({
      status: 'settled',
      reservation: { tokens: 100, cost: null, provenance: 'declared' },
      bound: { inputTokens: 60, maxOutputTokens: 40 },
    });
  });

  it.each<[string, UsageReport | null]>([
    [
      'cancelled',
      {
        callId: 'x',
        outcome: 'cancelled',
        provenance: 'reported',
        tokens: { input: 1, output: 1 },
        final: true,
      },
    ],
    [
      'failed with unknown usage',
      { callId: 'x', outcome: 'failed', provenance: 'unknown', final: true },
    ],
    [
      'completed with a partial report',
      {
        callId: 'x',
        outcome: 'completed',
        provenance: 'partial',
        tokens: { input: 1, output: 1 },
        final: true,
      },
    ],
    [
      'completed but still open to replacement',
      {
        callId: 'x',
        outcome: 'completed',
        provenance: 'reported',
        tokens: { input: 1, output: 1 },
        final: false,
      },
    ],
    [
      'completed without output tokens',
      {
        callId: 'x',
        outcome: 'completed',
        provenance: 'reported',
        tokens: { input: 1 },
        final: true,
      },
    ],
    ['never reported', null],
  ])('keeps the whole bound counted for a call that was %s', async (_label, report) => {
    const errors: unknown[] = [];
    await scripted({ budget: { tokens: 100 } }, async (services) => {
      await admit(services, 'x', bound(100));
      if (report) await services.recordUsage(report);
      errors.push(await rejection(admit(services, 'next', bound(1))));
    });
    expect(errors).toEqual([expect.objectContaining({ code: 'budget-limit' })]);
  });

  it('counts a report that shows more than the bound at what it shows', async () => {
    const errors: unknown[] = [];
    await scripted({ budget: { tokens: 100 } }, async (services) => {
      await admit(services, 'x', bound(40));
      await services.recordUsage({
        callId: 'x',
        outcome: 'completed',
        provenance: 'reported',
        tokens: { input: 70, output: 20 },
        final: false,
      });
      errors.push(await rejection(admit(services, 'fits', bound(10))));
      errors.push(await rejection(admit(services, 'over', bound(1))));
    });
    expect(errors).toEqual([undefined, expect.objectContaining({ code: 'budget-limit' })]);
  });

  it('never lets concurrent reservations in a parallel group exceed the budget', async () => {
    let started = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => (release = resolve));
    const outcomes: PromiseSettledResult<void>[] = [];
    const member = (id: string) =>
      enforced(id, async (_turn, options) => {
        if (++started === 2) release();
        await barrier;
        outcomes.push(
          ...(await Promise.allSettled([
            admit(options.services, `${id}-1`, bound(30)),
            admit(options.services, `${id}-2`, bound(30)),
          ])),
        );
        return speak(id);
      });
    const room = createRoundtable({
      conversationId: 'budget-parallel',
      participants: [member('a'), member('b')],
      maxConcurrentParticipants: 2,
      limits: { maxTurnsPerRun: 2 },
      budget: { tokens: 100 },
      selector: {
        modelCalls: 'none',
        select: () => ({ kind: 'parallel', participantIds: ['a', 'b'] }),
      },
    });
    const result = await room.run();
    expect(result).toMatchObject({ status: 'limited', reason: 'budget' });
    expect(outcomes.filter((entry) => entry.status === 'fulfilled')).toHaveLength(3);
    const rejected = outcomes.filter(
      (entry): entry is PromiseRejectedResult => entry.status === 'rejected',
    );
    expect(rejected.map((entry) => entry.reason)).toEqual([
      expect.objectContaining({ code: 'budget-limit' }),
    ]);
    expect(room.snapshot().usage).toHaveLength(3);
    await room.dispose();
  });
});

describe('a cost budget counts the price of each call at its bound', () => {
  it('admits a bound that exactly fills the budget and refuses one minor unit more', async () => {
    const errors: unknown[] = [];
    const { room } = await scripted(
      { budget: { cost: usd(100) }, pricing: perToken },
      async (services) => {
        await admit(services, 'fits', bound(60, 40));
        errors.push(await rejection(admit(services, 'over', bound(1))));
      },
    );
    expect(errors).toEqual([expect.objectContaining({ code: 'budget-limit' })]);
    expect(room.snapshot().usage[0].reservation).toEqual({
      tokens: 100,
      cost: usd(100),
      provenance: 'declared',
    });
  });

  it('replaces the reserved cost with the settled price', async () => {
    const errors: unknown[] = [];
    await scripted({ budget: { cost: usd(100) }, pricing: perToken }, async (services) => {
      await admit(services, 'first', bound(100));
      await services.recordUsage({
        callId: 'first',
        outcome: 'completed',
        provenance: 'reported',
        tokens: { input: 4, output: 6 },
        final: true,
      });
      errors.push(await rejection(admit(services, 'fits', bound(90))));
      errors.push(await rejection(admit(services, 'over', bound(1))));
    });
    expect(errors).toEqual([undefined, expect.objectContaining({ code: 'budget-limit' })]);
  });

  it('keeps the reserved cost for a call whose price is unknown', async () => {
    const errors: unknown[] = [];
    const unpriced: PricePolicy = { ...perToken, cost: () => null };
    await scripted({ budget: { cost: usd(100) }, pricing: unpriced }, async (services) => {
      await admit(services, 'first', bound(100));
      await services.recordUsage({
        callId: 'first',
        outcome: 'completed',
        provenance: 'reported',
        tokens: { input: 1, output: 1 },
        final: true,
      });
      errors.push(await rejection(admit(services, 'next', bound(1))));
    });
    expect(errors).toEqual([expect.objectContaining({ code: 'budget-limit' })]);
  });

  it('refuses a settlement priced in another currency or below zero, keeping the bound counted', async () => {
    for (const price of [
      { currency: 'EUR', minorUnits: '1' },
      { currency: 'USD', minorUnits: '-1' },
    ]) {
      const errors: unknown[] = [];
      const { room } = await scripted(
        { budget: { cost: usd(100) }, pricing: { ...perToken, cost: () => price } },
        async (services) => {
          await admit(services, 'x', bound(100));
          errors.push(
            await rejection(
              services.recordUsage({
                callId: 'x',
                outcome: 'completed',
                provenance: 'reported',
                tokens: { input: 1, output: 1 },
                final: true,
              }),
            ),
          );
          errors.push(await rejection(admit(services, 'next', bound(1))));
        },
      );
      expect(errors).toEqual([
        expect.objectContaining({ code: 'invalid-config' }),
        expect.objectContaining({ code: 'budget-limit' }),
      ]);
      expect(room.snapshot().usage[0].status).toBe('reserved');
    }
  });

  it.each([
    ['in another currency', { currency: 'EUR', minorUnits: '5' }],
    ['below zero', { currency: 'USD', minorUnits: '-5' }],
    ['not an integer amount', { currency: 'USD', minorUnits: '1.5' }],
  ])('refuses a pricing bound %s', async (_label, price) => {
    const errors: unknown[] = [];
    const { room } = await scripted(
      { budget: { cost: usd(100) }, pricing: { ...perToken, bound: () => price } },
      async (services) => {
        errors.push(await rejection(admit(services, 'x', bound(1))));
      },
    );
    expect(errors).toEqual([expect.objectContaining({ code: 'invalid-config' })]);
    expect(room.snapshot().usage).toEqual([]);
  });
});

describe('what a strict budget and an estimated budget admit', () => {
  it('refuses a call that declares no bound, and a call that pricing cannot bound', async () => {
    const errors: unknown[] = [];
    await scripted({ budget: { tokens: 100 } }, async (services) => {
      errors.push(await rejection(admit(services, 'unbounded')));
    });
    await scripted(
      { budget: { cost: usd(100) }, pricing: { ...perToken, bound: () => null } },
      async (services) => {
        errors.push(await rejection(admit(services, 'unpriceable', bound(1))));
      },
    );
    expect(errors).toEqual([
      expect.objectContaining({ code: 'invalid-config' }),
      expect.objectContaining({ code: 'invalid-config' }),
    ]);
  });

  it('refuses an invalid bound before any limit is checked', async () => {
    const errors: unknown[] = [];
    await scripted({ budget: { tokens: 100 } }, async (services) => {
      for (const bad of [
        bound(-1),
        bound(1.5),
        bound(1, Number.NaN),
        bound(Number.MAX_SAFE_INTEGER, 1),
      ])
        errors.push(await rejection(admit(services, 'x', bad)));
    });
    expect(errors.map((error) => (error as { code: string }).code)).toEqual(
      Array(4).fill('invalid-config'),
    );
  });

  it('reserves the estimator bound for a call that declares none and records it as estimated', async () => {
    const estimate = vi.fn(() => ({ bound: bound(30, 20) }));
    const { room } = await scripted(
      { budget: { tokens: 100, mode: 'estimated' }, estimator: { estimate } },
      async (services) => {
        await admit(services, 'guessed');
        await admit(services, 'declared', bound(10));
      },
    );
    expect(estimate).toHaveBeenCalledOnce();
    const [guessed, declared] = room.snapshot().usage;
    expect(guessed.reservation).toEqual({ tokens: 50, cost: null, provenance: 'estimated' });
    expect(guessed.bound).toBeUndefined();
    expect(declared.reservation).toEqual({ tokens: 10, cost: null, provenance: 'declared' });
  });

  it('prices an estimated call from the estimate when pricing cannot bound it', async () => {
    const { room } = await scripted(
      {
        budget: { cost: usd(100), mode: 'estimated' },
        pricing: { version: 'v', cost: () => null },
        estimator: { estimate: () => ({ bound: bound(5), cost: usd(7) }) },
      },
      async (services) => {
        await admit(services, 'guessed');
      },
    );
    expect(room.snapshot().usage[0].reservation).toEqual({
      tokens: 5,
      cost: usd(7),
      provenance: 'estimated',
    });
  });

  it('refuses an estimate that gives no bound, an invalid one, or one returned asynchronously', async () => {
    const errors: unknown[] = [];
    for (const estimate of [
      () => ({}),
      () => ({ bound: bound(-1) }),
      () => Promise.resolve({ bound: bound(1) }) as never,
    ]) {
      await scripted(
        { budget: { tokens: 100, mode: 'estimated' }, estimator: { estimate } },
        async (services) => {
          errors.push(await rejection(admit(services, 'guessed')));
        },
      );
    }
    expect(errors.map((error) => (error as { code?: string }).code)).toEqual(
      Array(3).fill('invalid-config'),
    );
  });

  it('refuses a pricing bound returned asynchronously', async () => {
    const errors: unknown[] = [];
    await scripted(
      {
        budget: { cost: usd(100) },
        pricing: { ...perToken, bound: () => Promise.resolve(usd(1)) as never },
      },
      async (services) => {
        errors.push(await rejection(admit(services, 'x', bound(1))));
      },
    );
    expect(errors).toEqual([expect.objectContaining({ code: 'invalid-config' })]);
  });
});

describe('admission is idempotent per call and bound', () => {
  it('reserves nothing twice for the same call, and refuses a changed bound', async () => {
    const errors: unknown[] = [];
    const { room } = await scripted({ budget: { tokens: 100 } }, async (services) => {
      await admit(services, 'x', bound(60));
      await admit(services, 'x', bound(60));
      errors.push(await rejection(admit(services, 'x', bound(61))));
      errors.push(await rejection(admit(services, 'x')));
      errors.push(await rejection(admit(services, 'y', bound(40))));
    });
    expect(errors).toEqual([
      expect.objectContaining({ code: 'conflict' }),
      expect.objectContaining({ code: 'conflict' }),
      undefined,
    ]);
    expect(room.snapshot().usage.map((record) => record.callId)).toEqual(['x', 'y']);
  });
});

describe('a spent budget ends the run limited', () => {
  it('stops a member mid-turn with reason budget, and the next run dispatches it again', async () => {
    const turns: ParticipantTurn[] = [];
    const room = createRoundtable({
      conversationId: 'budget-member',
      participants: [
        enforced('a', async (turn, options) => {
          turns.push(turn);
          if (turns.length === 1) {
            await admit(options.services, `${turn.attemptId}-1`, bound(60));
            await admit(options.services, `${turn.attemptId}-2`, bound(60));
          } else await admit(options.services, `${turn.attemptId}-1`, bound(30));
          return speak('spoke');
        }),
      ],
      limits: { maxTurnsPerRun: 1 },
      budget: { tokens: 100 },
    });
    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'budget' });
    expect(room.snapshot().messages).toEqual([]);
    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'turns' });
    expect(room.snapshot().messages.map((message) => message.content)).toEqual(['spoke']);
    expect(turns).toHaveLength(2);
    expect(turns[1].turnId).toBe(turns[0].turnId);
    await room.dispose();
  });

  it('stops a selector mid-selection with reason budget, and the next run asks it again', async () => {
    let selections = 0;
    const store = new MemoryConversationStore();
    const room = createRoundtable({
      conversationId: 'budget-selector',
      store,
      participants: [enforced('a', async () => speak())],
      selector: {
        modelCalls: 'enforced',
        select: async (_context, { services }) => {
          selections++;
          if (selections === 1) {
            await admit(services, 'select-1a', bound(60));
            await admit(services, 'select-1b', bound(60));
          } else await admit(services, 'select-2', bound(30));
          return { kind: 'finish', reason: 'done' };
        },
      },
      limits: { maxTurnsPerRun: 1 },
      budget: { tokens: 100 },
    });
    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'budget' });
    expect((await store.load('budget-selector'))?.state).toMatchObject({
      terminal: null,
      phase: { kind: 'ready' },
    });
    expect(await room.run()).toMatchObject({ status: 'completed', reason: 'done' });
    expect(selections).toBe(2);
    await room.dispose();
  });

  it('refuses a group whole before dispatch once nothing is left, while a no-model-call group still runs', async () => {
    const aRuns = vi.fn();
    const bRuns = vi.fn();
    const silent: AgentParticipant = {
      kind: 'agent',
      id: 'silent',
      runtime: { id: 'silent', version: '1' },
      factory: {
        modelCalls: 'none',
        openSession: async () => ({
          session: { runTurn: async () => speak('silent') },
          release: async () => {},
        }),
      },
    };
    const room = createRoundtable({
      conversationId: 'budget-group',
      participants: [
        enforced('a', async (_turn, options) => {
          aRuns();
          await admit(options.services, 'a-1', bound(10));
          return speak('a');
        }),
        enforced('b', async () => {
          bRuns();
          return speak('b');
        }),
      ],
      maxConcurrentParticipants: 2,
      limits: { maxTurnsPerRun: 5 },
      budget: { tokens: 10 },
      selector: {
        modelCalls: 'none',
        select: ({ turns }) =>
          turns.length === 0
            ? { kind: 'speak', participantId: 'a' }
            : { kind: 'parallel', participantIds: ['a', 'b'] },
      },
    });
    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'budget' });
    expect(aRuns).toHaveBeenCalledOnce();
    expect(bRuns).not.toHaveBeenCalled();
    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'budget' });
    expect(aRuns).toHaveBeenCalledOnce();
    await room.dispose();

    const silentRoom = createRoundtable({
      conversationId: 'budget-silent',
      participants: [silent],
      limits: { maxTurnsPerRun: 2 },
      budget: { tokens: 10 },
      selector: {
        modelCalls: 'none',
        select: ({ turns }) =>
          turns.length
            ? { kind: 'finish', reason: 'done' }
            : { kind: 'speak', participantId: 'silent' },
      },
    });
    expect(await silentRoom.run()).toMatchObject({ status: 'completed', reason: 'done' });
    await silentRoom.dispose();
  });

  it('reports the call-count limit before the budget when both are spent', async () => {
    const room = createRoundtable({
      conversationId: 'budget-and-count',
      participants: [
        enforced('a', async (_turn, options) => {
          await admit(options.services, 'a-1', bound(10));
          return speak();
        }),
      ],
      limits: { maxTurnsPerRun: 3, maxModelCallsPerConversation: 1 },
      budget: { tokens: 10 },
    });
    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'model-calls' });
    await room.dispose();
  });

  it('does not call a metered-or-enforced selector once the budget is fully spent', async () => {
    const select = vi.fn(async (_context: unknown, { services }: { services: TurnServices }) => {
      await admit(services, crypto.randomUUID(), bound(10));
      return { kind: 'speak' as const, participantId: 'a' };
    });
    const room = createRoundtable({
      conversationId: 'budget-selector-precheck',
      participants: [enforced('a', async () => speak())],
      selector: { modelCalls: 'enforced', select },
      limits: { maxTurnsPerRun: 3 },
      budget: { tokens: 10 },
    });
    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'budget' });
    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'budget' });
    expect(select).toHaveBeenCalledOnce();
    await room.dispose();
  });
});

describe('the host reconciles a call whose usage was never fully reported', () => {
  /** A conversation whose participant admits one call per run and never reports it. */
  function neverReported(extra: Partial<RoundtableOptions> = {}) {
    const runs: ParticipantTurn[] = [];
    const room = createRoundtable({
      conversationId: crypto.randomUUID(),
      participants: [
        enforced('a', async (turn, options) => {
          runs.push(turn);
          if (runs.length === 1) await admit(options.services, 'lost', bound(100));
          else if (runs.length === 2) await admit(options.services, 'after', bound(90));
          return speak();
        }),
      ],
      limits: { maxTurnsPerRun: 1 },
      budget: { tokens: 100 },
      ...extra,
    });
    return { room, runs };
  }

  it('replaces the retained bound with the host amounts and frees the difference', async () => {
    const { room, runs } = neverReported();
    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'turns' });
    // The unreported call keeps its whole bound, so nothing is left to start another turn.
    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'budget' });
    expect(runs).toHaveLength(1);

    const before = room.snapshot().revision;
    const receipt = await room.reconcileUsage({ callId: 'lost', tokens: 10 });
    expect(receipt.revision).toBeGreaterThan(before);
    expect(room.snapshot().revision).toBe(receipt.revision);
    expect(room.snapshot().usage[0]).toMatchObject({
      status: 'reserved',
      reservation: { tokens: 100 },
      reconciled: { tokens: 10, cost: null },
      revision: receipt.revision,
    });

    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'turns' });
    expect(runs).toHaveLength(2);
    await room.dispose();
  });

  it('is a no-op for the same amounts and a conflict for different ones', async () => {
    const { room } = neverReported();
    await room.run();
    const first = await room.reconcileUsage({ callId: 'lost', tokens: 10 });
    expect(await room.reconcileUsage({ callId: 'lost', tokens: 10 })).toEqual(first);
    expect(room.snapshot().revision).toBe(first.revision);
    await expect(room.reconcileUsage({ callId: 'lost', tokens: 11 })).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(room.snapshot().usage[0].reconciled).toEqual({ tokens: 10, cost: null });
    await room.dispose();
  });

  it('never changes a call count, a status or an outcome', async () => {
    const { room, runs } = neverReported({
      limits: { maxTurnsPerRun: 1, maxModelCallsPerConversation: 1 },
    });
    await room.run();
    const before = summarizeUsage(room.snapshot().usage);
    await room.reconcileUsage({ callId: 'lost', tokens: 0 });
    expect(summarizeUsage(room.snapshot().usage)).toEqual(before);
    // The budget has room again, but the one allowed call was still made.
    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'model-calls' });
    expect(runs).toHaveLength(1);
    await room.dispose();
  });

  it('refuses an unknown call, a fully reported call and an admission-free cache hit', async () => {
    let services!: TurnServices;
    const room = createRoundtable({
      conversationId: 'reconcile-conflicts',
      participants: [
        enforced('a', async (_turn, options) => {
          services = options.services;
          await admit(options.services, 'reported', bound(10));
          await options.services.recordUsage({
            callId: 'reported',
            outcome: 'completed',
            provenance: 'reported',
            tokens: { input: 1, output: 1 },
            final: true,
          });
          await options.services.recordUsage({
            callId: 'hit',
            outcome: 'cache-hit',
            provenance: 'reported',
            providerId: 'p',
            modelId: 'm',
            final: true,
          });
          return speak();
        }),
      ],
      limits: { maxTurnsPerRun: 1 },
      budget: { tokens: 100 },
    });
    await room.run();
    for (const callId of ['nobody', 'reported', 'hit'])
      await expect(room.reconcileUsage({ callId, tokens: 0 })).rejects.toMatchObject({
        code: 'conflict',
      });
    expect(Object.keys(services)).not.toContain('reconcileUsage');
    await room.dispose();
  });

  it('refuses any further report for a call it reconciled', async () => {
    let second: unknown;
    const runs: number[] = [];
    const room = createRoundtable({
      conversationId: 'reconcile-then-report',
      participants: [
        enforced('a', async (_turn, options) => {
          runs.push(runs.length);
          if (runs.length === 1) await admit(options.services, 'lost', bound(10));
          else
            second = await rejection(
              options.services.recordUsage({
                callId: 'lost',
                outcome: 'completed',
                provenance: 'reported',
                tokens: { input: 1, output: 1 },
                final: true,
              }),
            );
          return speak();
        }),
      ],
      limits: { maxTurnsPerRun: 1 },
      budget: { tokens: 100 },
    });
    await room.run();
    await room.reconcileUsage({ callId: 'lost', tokens: 3 });
    await room.run();
    expect(second).toMatchObject({ code: 'conflict' });
    expect(room.snapshot().usage[0].status).toBe('reserved');
    await room.dispose();
  });

  it('reconciles a cost budget in the budget currency only', async () => {
    const room = createRoundtable({
      conversationId: 'reconcile-cost',
      participants: [
        enforced('a', async (_turn, options) => {
          await admit(options.services, 'lost', bound(100));
          return speak();
        }),
      ],
      limits: { maxTurnsPerRun: 1 },
      budget: { cost: usd(100) },
      pricing: perToken,
    });
    await room.run();
    for (const input of [
      { callId: 'lost', tokens: 1 },
      { callId: 'lost', tokens: 1, cost: { currency: 'EUR', minorUnits: '1' } },
      { callId: 'lost', tokens: 1, cost: usd(-1) },
    ])
      await expect(room.reconcileUsage(input)).rejects.toMatchObject({ code: 'invalid-config' });
    await room.reconcileUsage({ callId: 'lost', tokens: 1, cost: usd(5) });
    expect(room.snapshot().usage[0].reconciled).toEqual({ tokens: 1, cost: usd(5) });
    await room.dispose();
  });

  it.each([
    ['negative tokens', { callId: 'lost', tokens: -1 }],
    ['fractional tokens', { callId: 'lost', tokens: 1.5 }],
    ['a cost with no cost budget', { callId: 'lost', tokens: 1, cost: usd(1) }],
    ['no call id', { callId: '', tokens: 1 }],
  ])('refuses %s', async (_label, input) => {
    const { room } = neverReported();
    await room.run();
    await expect(room.reconcileUsage(input)).rejects.toMatchObject({ code: 'invalid-config' });
    expect(room.snapshot().usage[0].reconciled).toBeNull();
    await room.dispose();
  });

  it('is refused without a budget', async () => {
    const { room } = await scripted({}, async (services) => {
      await admit(services, 'x');
    });
    await expect(room.reconcileUsage({ callId: 'x', tokens: 1 })).rejects.toMatchObject({
      code: 'invalid-config',
    });
    await room.dispose();
  });

  it('is refused while a run is active and after dispose', async () => {
    let busy: unknown;
    const { room } = await scripted({ budget: { tokens: 100 } }, async (services, current) => {
      await admit(services, 'x', bound(10));
      busy = await rejection(current().reconcileUsage({ callId: 'x', tokens: 1 }));
    });
    expect(busy).toMatchObject({ code: 'busy' });
    await room.dispose();
    await expect(room.reconcileUsage({ callId: 'x', tokens: 1 })).rejects.toMatchObject({
      code: 'disposed',
    });
  });
});

describe('a budget configuration no admission could satisfy is refused at construction', () => {
  const participants = [enforced('a', async () => speak())];
  const make = (extra: Partial<RoundtableOptions>) =>
    createRoundtable({
      conversationId: 'invalid',
      participants,
      limits: { maxTurnsPerRun: 1 },
      ...extra,
    });

  it.each<[string, Partial<RoundtableOptions>]>([
    ['no amount', { budget: {} }],
    ['zero tokens', { budget: { tokens: 0 } }],
    ['negative tokens', { budget: { tokens: -1 } }],
    ['fractional tokens', { budget: { tokens: 1.5 } }],
    ['unsafe tokens', { budget: { tokens: 2 ** 53 } }],
    [
      'a cost without a currency',
      { budget: { cost: { currency: '', minorUnits: '5' } }, pricing: perToken },
    ],
    ['a zero cost', { budget: { cost: usd(0) }, pricing: perToken }],
    ['a negative cost', { budget: { cost: usd(-5) }, pricing: perToken }],
    ['a fractional cost', { budget: { cost: usd('1.5') }, pricing: perToken }],
    ['an unknown mode', { budget: { tokens: 1, mode: 'loose' as never } }],
    ['a cost without pricing', { budget: { cost: usd(5) } }],
    [
      'a strict cost budget whose pricing has no bound',
      { budget: { cost: usd(5) }, pricing: { version: 'v', cost: () => null } },
    ],
    ['an estimated budget without an estimator', { budget: { tokens: 1, mode: 'estimated' } }],
    [
      'an estimator with a strict budget',
      { budget: { tokens: 1 }, estimator: { estimate: () => ({}) } },
    ],
    ['an estimator with no budget', { estimator: { estimate: () => ({}) } }],
  ])('%s', (_label, extra) => {
    expect(() => make(extra)).toThrow(expect.objectContaining({ code: 'invalid-config' }));
  });

  it('accepts a token amount, a cost amount, or both', async () => {
    for (const budget of [{ tokens: 5 }, { cost: usd(5) }, { tokens: 5, cost: usd(5) }])
      await make({ budget, pricing: perToken }).dispose();
  });
});

describe('a budget requires every caller to make no calls or declare bounds', () => {
  const withFactory = (modelCalls: ParticipantFactory['modelCalls']): AgentParticipant => ({
    kind: 'agent',
    id: 'a',
    runtime: { id: 'test', version: '1' },
    factory: {
      ...(modelCalls === undefined ? {} : { modelCalls }),
      openSession: async () => ({
        session: { runTurn: async () => speak() },
        release: async () => {},
      }),
    },
  });
  const make = (participant: AgentParticipant, selector?: RoundtableOptions['selector']) =>
    createRoundtable({
      conversationId: 'capability',
      participants: [participant, { kind: 'external', id: 'person' }],
      ...(selector ? { selector } : {}),
      limits: { maxTurnsPerRun: 1 },
      budget: { tokens: 10 },
    });

  it.each(['metered', undefined] as const)(
    'refuses an agent factory declaring %s',
    (modelCalls) => {
      expect(() => make(withFactory(modelCalls))).toThrow(
        expect.objectContaining({ code: 'invalid-config' }),
      );
    },
  );

  it.each(['metered', undefined] as const)('refuses a selector declaring %s', (modelCalls) => {
    expect(() =>
      make(withFactory('enforced'), {
        ...(modelCalls ? { modelCalls } : {}),
        select: () => ({ kind: 'finish', reason: 'done' }),
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-config' }));
  });

  it.each(['none', 'enforced'] as const)(
    'accepts an agent factory declaring %s',
    async (modelCalls) => {
      const room = make(withFactory(modelCalls));
      await room.dispose();
    },
  );

  it('still lets a metered caller work in a conversation with no budget', async () => {
    const room = createRoundtable({
      conversationId: 'no-budget-metered',
      participants: [withFactory('metered')],
      limits: { maxTurnsPerRun: 1, maxModelCallsPerRun: 5 },
    });
    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'turns' });
    await room.dispose();
  });
});

describe('loading a conversation saved with a budget', () => {
  function fixture(modelCalls: ParticipantFactory['modelCalls'] = 'enforced') {
    const runs = vi.fn();
    const opened = vi.fn();
    const factory: ParticipantFactory = {
      modelCalls,
      checkpointVersions: ['1'],
      openSession: async () => {
        opened();
        return {
          session: {
            runTurn: async (_turn, options) => {
              runs();
              await admit(options.services, crypto.randomUUID(), bound(100));
              return speak();
            },
            checkpoint: async () => ({ version: '1', data: null }),
          },
          release: async () => {},
        };
      },
    };
    const participant: AgentParticipant = {
      kind: 'agent',
      id: 'a',
      runtime: { id: 'echo', version: '1' },
      factory,
    };
    const resolveParticipant = vi.fn(async () => ({ reference: participant.runtime, factory }));
    return { participant, registry: { resolveParticipant }, runs, opened, resolveParticipant };
  }

  async function saved(extra: Partial<RoundtableOptions>, f = fixture()) {
    const store = new MemoryConversationStore();
    const conversationId = crypto.randomUUID();
    const room = createRoundtable({
      conversationId,
      store,
      participants: [f.participant],
      limits: { maxTurnsPerRun: 1 },
      ...extra,
    });
    await room.run();
    await room.dispose();
    f.runs.mockClear();
    f.opened.mockClear();
    f.resolveParticipant.mockClear();
    return { store, conversationId, f };
  }

  it('keeps the saved budget and what it already spent', async () => {
    const { store, conversationId, f } = await saved({ budget: { tokens: 100 } });
    expect((await store.load(conversationId))?.state).toMatchObject({
      definition: { budget: { tokens: 100, cost: null, mode: 'strict' } },
    });
    const loaded = await loadRoundtable({ conversationId, store, registry: f.registry });
    expect(loaded.snapshot().usage[0]).toMatchObject({ reservation: { tokens: 100 } });
    expect(await loaded.run()).toMatchObject({ status: 'limited', reason: 'budget' });
    expect(f.runs).not.toHaveBeenCalled();
    await loaded.dispose();
  });

  it('keeps a reconcile across a load', async () => {
    const { store, conversationId, f } = await saved({ budget: { tokens: 100 } });
    const loaded = await loadRoundtable({ conversationId, store, registry: f.registry });
    const callId = loaded.snapshot().usage[0].callId;
    await loaded.reconcileUsage({ callId, tokens: 0 });
    await loaded.dispose();
    const again = await loadRoundtable({ conversationId, store, registry: f.registry });
    expect(again.snapshot().usage[0].reconciled).toEqual({ tokens: 0, cost: null });
    expect(await again.run()).toMatchObject({ status: 'limited', reason: 'turns' });
    expect(f.runs).toHaveBeenCalledOnce();
    await again.dispose();
  });

  it.each<[string, Partial<RoundtableOptions>, Partial<LoadRoundtableOptions>]>([
    [
      'a cost budget whose pricing declares no bound',
      { budget: { cost: usd(1000) }, pricing: perToken },
      { pricing: { version: 'per-token', cost: () => null } },
    ],
    [
      'an estimated budget with no estimator',
      {
        budget: { tokens: 100, mode: 'estimated' },
        estimator: { estimate: () => ({ bound: bound(1) }) },
      },
      {},
    ],
    [
      'a strict budget with an estimator',
      { budget: { tokens: 100 } },
      { estimator: { estimate: () => ({}) } },
    ],
    ['no budget with an estimator', {}, { estimator: { estimate: () => ({}) } }],
  ])('refuses %s before any registry call', async (_label, create, load) => {
    const { store, conversationId, f } = await saved(create);
    await expect(
      loadRoundtable({ conversationId, store, registry: f.registry, ...load }),
    ).rejects.toMatchObject({ code: 'invalid-config' });
    expect(f.resolveParticipant).not.toHaveBeenCalled();
    expect(f.opened).not.toHaveBeenCalled();
  });

  it('refuses a registry factory that is only metered before any session opens', async () => {
    const { store, conversationId, f } = await saved({ budget: { tokens: 100 } });
    const metered = fixture('metered');
    await expect(
      loadRoundtable({ conversationId, store, registry: metered.registry }),
    ).rejects.toMatchObject({ code: 'invalid-config' });
    expect(metered.opened).not.toHaveBeenCalled();
    expect(f.opened).not.toHaveBeenCalled();
  });

  it('loads an estimated budget with the estimator it needs', async () => {
    const estimator = { estimate: () => ({ bound: bound(1) }) };
    const { store, conversationId, f } = await saved({
      budget: { tokens: 100, mode: 'estimated' },
      estimator,
    });
    const loaded = await loadRoundtable({ conversationId, store, registry: f.registry, estimator });
    expect(await loaded.run()).toMatchObject({ status: 'limited', reason: 'budget' });
    await loaded.dispose();
  });
});
