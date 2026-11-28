import { expect } from 'vitest';
import { FunctionTool } from '@robota-sdk/agent-core';
import type { IAIProvider, TUniversalMessage } from '@robota-sdk/agent-core';
import {
  createRoundtable,
  loadRoundtable,
  type AgentParticipant,
  type Roundtable,
  type RoundtableOptions,
  type ResumeRequest,
  type RunResult,
  type TurnSelector,
  type UsageRecord,
} from '@robota-sdk/agent-roundtable';
import { sessionParticipant } from './session-participant';
import type { Generation } from './recovery-drill';
import { LEASE_MS, World, type KillPlan } from './recovery-drill';

/**
 * A conversation to sweep kill points over: members take turns, each member's model answers as a
 * pure function of what it was last shown, so a run, a killed run and a recovered run say the same.
 */
export interface MatrixScenario {
  name: string;
  members: string[];
  /** Turns the conversation lasts; members speak in the order listed, repeating. */
  turns: number;
  /** Paid effects a member's turn causes, one per model round. */
  effectsOf: (participantId: string) => number;
  /** Whether the paid tool waits for the host's approval before it runs. */
  approval?: boolean;
}

/** The conversations every sweep, kill or in-process stop, runs over. */
export const scenarios: MatrixScenario[] = [
  { name: 'a plain text turn', members: ['solo'], turns: 1, effectsOf: () => 0 },
  { name: 'a turn with one paid effect', members: ['solo'], turns: 1, effectsOf: () => 1 },
  {
    name: 'a turn with two paid effects in sequence',
    members: ['solo'],
    turns: 1,
    effectsOf: () => 2,
  },
  {
    name: 'a conversation of two members',
    members: ['alice', 'bob'],
    turns: 3,
    effectsOf: (id) => (id === 'alice' ? 1 : 0),
  },
  {
    name: 'a turn that parks an approval wait and continues it',
    members: ['solo'],
    turns: 1,
    effectsOf: () => 1,
    approval: true,
  },
];

/** What the host answers to a parked reconciliation. */
export type HostMode = 'value' | 'failure';

const FNV_OFFSET = 0x811c9dc5;

function hash(text: string): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

const RESULT_TOKEN = /\b(?:paid|declined):[\w-]+/g;

function textOf(message: TUniversalMessage): string {
  return typeof message.content === 'string' ? message.content : '';
}

/**
 * The scripted model: what a member says and which effect it causes are pure functions of the last
 * user message and the tool results after it. Result tokens are masked in what it was shown, so an
 * effect id never depends on whether an earlier effect was settled with a value or an error.
 */
function scriptedModel(scenario: MatrixScenario, participantId: string, gen: Generation) {
  const provider: IAIProvider = {
    name: 'matrix-provider',
    version: 'test',
    chat: (messages) =>
      gen.io(async () => {
        const last = messages.findLastIndex((message) => message.role === 'user');
        const shown = textOf(messages[last]!).replace(RESULT_TOKEN, 'R');
        const results = messages
          .slice(last + 1)
          .filter((message) => message.role === 'tool')
          .map((message) => textOf(message).match(RESULT_TOKEN)?.[0] ?? 'none');
        const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
        const base = {
          id: `reply-${hash(shown)}-${results.length}`,
          role: 'assistant' as const,
          state: 'complete' as const,
          timestamp: new Date(0),
          metadata: { ...usage, usageProvenance: 'complete' },
        };
        if (results.length < scenario.effectsOf(participantId)) {
          const effect = `${participantId}-${hash(shown)}-${results.length}`;
          return {
            ...base,
            content: null,
            toolCalls: [
              {
                id: `call-${effect}`,
                type: 'function' as const,
                function: { name: 'pay', arguments: JSON.stringify({ effect }) },
              },
            ],
          };
        }
        return {
          ...base,
          content: `${participantId} ${results.length ? results.join(' + ') : hash(shown)}`,
        };
      }),
    generateResponse: async () => ({ content: 'not implemented' }),
    supportsTools: () => true,
    validateConfig: () => true,
  };
  return provider;
}

function member(scenario: MatrixScenario, gen: Generation, id: string): AgentParticipant {
  const tool = new FunctionTool(
    {
      name: 'pay',
      description: 'Pays',
      parameters: { type: 'object', properties: { effect: { type: 'string' } } },
    },
    async (args) => {
      const effect = String((args as { effect?: unknown }).effect);
      return gen.io(async () => {
        gen.world.effects.set(effect, (gen.world.effects.get(effect) ?? 0) + 1);
        return `paid:${effect}`;
      });
    },
  );
  return sessionParticipant({
    id,
    runtime: { id: `matrix/${id}`, version: '1' },
    enforcement: {
      providerAttempts: 1,
      requestOverheadTokens: 0,
      paidTools: { pay: { tokens: 0 } },
    },
    recovery: { journal: (scope) => gen.journal(scope) },
    createSessionOptions: async () => ({
      cwd: process.cwd(),
      hookTypeExecutors: [],
      tools: [tool],
      provider: scriptedModel(scenario, id, gen),
      systemMessage: 'Matrix host',
      model: 'test-model',
      autoCompactThreshold: false,
      maxOutputTokens: 64,
      permissions: scenario.approval
        ? { allow: [], deny: [], ask: ['pay'] }
        : { allow: ['pay'], deny: [], ask: [] },
    }),
  });
}

function selectorOf(scenario: MatrixScenario): TurnSelector {
  return {
    reference: { id: 'matrix/round-robin', version: '1' },
    modelCalls: 'none',
    recovery: 'reconcilable',
    idempotentDecision: true,
    select: ({ turns }) =>
      turns.length >= scenario.turns
        ? { kind: 'finish', reason: 'done' }
        : {
            kind: 'speak',
            participantId: scenario.members[turns.length % scenario.members.length]!,
          },
  };
}

/** Limits a case adds to the scenario's own. */
export interface ExtraLimits {
  timeoutMs?: number;
  maxModelCallsPerRun?: number;
}

function options(
  scenario: MatrixScenario,
  gen: Generation,
  extra: ExtraLimits = {},
): RoundtableOptions {
  return {
    conversationId: 'room',
    store: gen.store,
    recovery: 'durable',
    leaseMs: LEASE_MS,
    selector: selectorOf(scenario),
    participants: scenario.members.map((id) => member(scenario, gen, id)),
    limits: { maxTurnsPerRun: scenario.turns + 2, ...extra },
    budget: { tokens: 100_000, mode: 'strict' },
  };
}

export function createIn(
  scenario: MatrixScenario,
  gen: Generation,
  extra: ExtraLimits = {},
): Roundtable {
  return createRoundtable(options(scenario, gen, extra));
}

export function loadIn(scenario: MatrixScenario, gen: Generation): Promise<Roundtable> {
  const agents = new Map(
    (options(scenario, gen).participants as AgentParticipant[]).map((participant) => [
      participant.runtime.id,
      participant,
    ]),
  );
  return loadRoundtable({
    conversationId: 'room',
    store: gen.store,
    registry: {
      resolveParticipant: (reference) => ({
        reference,
        factory: agents.get(reference.id)!.factory,
      }),
      resolveSelector: (reference) => ({ reference, create: () => selectorOf(scenario) }),
    },
  });
}

export type Driven = { killed: true } | { killed: false; result: RunResult };

/** An effect the host settled after a restart, and how. */
export interface SettledEffect {
  effect: string;
  answer: 'value' | 'failure';
}

/** Gives the process one more chance to be killed before the host's next step. */
function until<T>(gen: Generation, work: Promise<T>): Promise<{ done: T } | { killed: true }> {
  work.catch(() => {});
  return Promise.race([
    work.then((done) => ({ done })),
    gen.whenKilled.then(() => ({ killed: true as const })),
  ]);
}

/**
 * A dead process leaves its conversation handle behind. Disposing it stops its lease timers, which
 * would otherwise keep hundreds of abandoned conversations alive; its I/O still hangs, so nothing it
 * does afterwards reaches the world.
 */
function abandon(room: Roundtable): { killed: true } {
  void room.dispose().catch(() => {});
  return { killed: true };
}

/** What the host answers to one parked request, from what the outside world shows. */
function hostAnswer(
  world: World,
  request: { kind: string; data?: unknown },
  mode: HostMode,
  settled: SettledEffect[],
): ResumeRequest['response'] {
  if (request.kind === 'approval') return { kind: 'approval', approved: true };
  if (request.kind !== 'reconciliation') throw new Error(`Unexpected request ${request.kind}`);
  const { effect } = (request.data as { parameters: { effect: string } }).parameters;
  const ranAlready = (world.effects.get(effect) ?? 0) > 0;
  // The host can only report a failure for an effect that provably did not happen.
  const answer = mode === 'failure' && !ranAlready ? 'failure' : 'value';
  if (answer === 'value' && !ranAlready) world.effects.set(effect, 1);
  settled.push({ effect, answer });
  return {
    kind: 'reconciliation',
    data: answer === 'value' ? { result: `paid:${effect}` } : { error: `declined:${effect}` },
  };
}

/**
 * Runs the conversation as its host would: approves every approval, settles every reconciliation
 * from what the outside world shows, and runs again until it stops waiting or the process dies.
 * `settled` collects what the host settled, which survives the process being killed after it did.
 * `waitingAt` sees each wait before the host answers it.
 */
export async function drive(
  world: World,
  gen: Generation,
  room: Roundtable,
  mode: HostMode,
  settled: SettledEffect[],
  waitingAt?: (requests: readonly { kind: string; data?: unknown }[]) => void,
): Promise<Driven> {
  for (let rounds = 0; ; rounds++) {
    if (rounds > 12) throw new Error('The conversation keeps waiting after the host answered it');
    const ran = await until(gen, room.run());
    if ('killed' in ran) return abandon(room);
    const { done: result } = ran;
    if (result.status !== 'waiting') return { killed: false, result };
    waitingAt?.(result.requests);
    for (const request of result.requests) {
      const response = hostAnswer(world, request, mode, settled);
      const sent = await until(
        gen,
        room.resume({
          requestId: request.id,
          responseId: `host:${request.id}`,
          expectedRevision: room.snapshot().revision,
          response,
        }),
      );
      if ('killed' in sent) return abandon(room);
    }
  }
}

export interface Reference {
  writes: number;
  appends: number;
  messages: string[][];
  ran: Record<string, number>;
  /** The completed calls, which a recovered run must reproduce. */
  completed: string[];
}

export const completedCalls = (usage: readonly UsageRecord[]): string[] =>
  usage
    .filter((record) => record.status === 'settled' && record.outcome === 'completed')
    .map((record) =>
      record.status === 'settled'
        ? `${record.kind}:${record.tokens?.input ?? 0}/${record.tokens?.output ?? 0}`
        : '',
    )
    .sort();

export const transcript = (room: Roundtable): string[][] =>
  room.snapshot().messages.map((message) => [message.participantId, message.content]);

/** The uninterrupted run, whose every write and journal append is a kill point. */
export async function reference(scenario: MatrixScenario): Promise<Reference> {
  const world = new World();
  const gen = world.generation();
  const room = createIn(scenario, gen);
  const out = await drive(world, gen, room, 'value', []);
  if (out.killed) throw new Error('The uninterrupted run was killed');
  if (out.result.status !== 'completed')
    throw new Error(`The reference ended ${JSON.stringify(out.result)}`);
  const done: Reference = {
    writes: gen.writes,
    appends: gen.appends,
    messages: transcript(room),
    ran: Object.fromEntries(world.effects),
    completed: completedCalls(room.snapshot().usage),
  };
  await room.dispose();
  return done;
}

export function plansFor(ref: Pick<Reference, 'writes' | 'appends'>): KillPlan[] {
  const plans: KillPlan[] = [];
  for (let n = 0; n < ref.writes; n++)
    for (const replyLost of [false, true]) plans.push({ at: 'commit', n, replyLost });
  for (let k = 0; k < ref.appends; k++)
    for (const written of [false, true]) plans.push({ at: 'append', k, written });
  return plans;
}

export const label = (plan: KillPlan): string =>
  plan.at === 'commit'
    ? `after commit ${plan.n}, reply ${plan.replyLost ? 'lost' : 'delivered'}`
    : `at append ${plan.k}, ${plan.written ? 'written' : 'not written'}`;

/** What a recovered conversation's ledger holds, so a sweep can say which recovery paths it reached. */
export interface Reached {
  refundedCalls: number;
  retainedModelCalls: number;
  retainedEffects: number;
  parked: number;
}

/**
 * The same assertions for every way a conversation is stopped and continued: it ends as the
 * uninterrupted one did; every effect the reference completed ran exactly once and none ran twice;
 * the transcript is the uninterrupted one except where the host said an effect failed; every
 * reserved call ends answered once under its own id; and the ledger holds every call the reference
 * completed, except an effect the host had to settle, which stays counted at its bound.
 */
export function expectRecovered(options: {
  ref: Reference;
  world: World;
  room: Roundtable;
  result: RunResult;
  settled: readonly SettledEffect[];
}): Reached {
  const { ref, world, room, result, settled } = options;
  expect(result).toMatchObject({ status: 'completed', reason: 'done' });
  const view = room.snapshot();
  const failed = new Set(settled.filter((s) => s.answer === 'failure').map((s) => s.effect));
  const expectedEffects = Object.fromEntries(
    Object.entries(ref.ran).filter(([effect]) => !failed.has(effect)),
  );
  for (const count of world.effects.values()) expect(count).toBe(1);
  expect(Object.fromEntries(world.effects)).toEqual(expectedEffects);
  const expected = ref.messages.map(([who, text]) => [
    who,
    [...failed].reduce(
      (said, effect) => said.replace(`paid:${effect}`, `declined:${effect}`),
      text!,
    ),
  ]);
  expect(transcript(room)).toEqual(expected);
  expect(view.requests).toEqual([]);

  expect(new Set(view.usage.map((record) => record.callId)).size).toBe(view.usage.length);
  for (const record of view.usage) {
    expect(record.status).toBe('settled');
    if (record.status === 'settled' && record.outcome === 'not-dispatched')
      expect(record.tokens).toBeUndefined();
  }
  const retained = view.usage.filter(
    (record) =>
      record.kind === 'tool-effect' &&
      record.status === 'settled' &&
      record.outcome !== 'completed' &&
      record.outcome !== 'not-dispatched',
  );
  expect(retained).toHaveLength(settled.length);
  const wanted = [...ref.completed];
  for (const call of completedCalls(view.usage)) {
    const at = wanted.indexOf(call);
    if (at >= 0) wanted.splice(at, 1);
  }
  expect(wanted).toEqual(settled.map(() => 'tool-effect:0/0'));

  const reached: Reached = {
    refundedCalls: 0,
    retainedModelCalls: 0,
    retainedEffects: 0,
    parked: settled.length,
  };
  for (const record of view.usage) {
    if (record.status !== 'settled') continue;
    if (record.outcome === 'not-dispatched') reached.refundedCalls++;
    else if (record.outcome !== 'completed')
      reached[record.kind === 'model' ? 'retainedModelCalls' : 'retainedEffects']++;
  }
  return reached;
}

/** How a conversation is stopped without its process dying. */
export type Stop = 'cancel' | 'dispose' | 'time';

/** A timeout no test waits for: its timer is found by this delay and fired by hand. */
const TIMEOUT_MS = 7_777_777;

/**
 * Stops a running conversation in-process at a chosen point and continues it as its host would:
 * the same room after a cancel or a time limit, a freshly loaded one after a disposal. `fire` is the
 * stop itself, to be called from the generation's interrupt hook.
 */
export class InProcessStop {
  private abort = new AbortController();
  private expire: (() => void) | undefined;
  private room: Roundtable | undefined;
  private disposing: Promise<void> | undefined;
  private readonly realSetTimeout = globalThis.setTimeout;
  /** Stops that landed, and how many of them ended a run. */
  fired = 0;

  constructor(readonly kind: Stop) {}

  /** Limits a room needs for this kind of stop to be possible. */
  get limits(): ExtraLimits {
    return this.kind === 'time' ? { timeoutMs: TIMEOUT_MS } : {};
  }

  /** Makes the room's timeout timer one this stop can fire by hand; undone by `restore`. */
  hook(): () => void {
    if (this.kind !== 'time') return () => {};
    const real = globalThis.setTimeout;
    globalThis.setTimeout = ((handler: () => void, ms?: number, ...rest: unknown[]) => {
      if (ms === TIMEOUT_MS) this.expire = handler;
      return this.realSetTimeout(handler, ms === TIMEOUT_MS ? 0x7fffffff : ms, ...rest);
    }) as typeof setTimeout;
    return () => {
      globalThis.setTimeout = real;
    };
  }

  attach(room: Roundtable): void {
    this.room = room;
  }

  fire = (): void => {
    this.fired++;
    if (this.kind === 'cancel') this.abort.abort();
    else if (this.kind === 'dispose') this.disposing = this.room!.dispose().catch(() => {});
    else this.expire?.();
  };

  /** The room to use next: a disposed one is replaced by one loaded from what it saved. */
  async next(scenario: MatrixScenario, world: World, room: Roundtable): Promise<Roundtable> {
    if (!this.disposing) return room;
    await this.disposing;
    this.disposing = undefined;
    return loadIn(scenario, world.generation());
  }

  run(room: Roundtable): Promise<RunResult> {
    if (this.abort.signal.aborted) this.abort = new AbortController();
    return room.run({ signal: this.abort.signal });
  }
}

/**
 * Runs the conversation as its host would while `stop` interrupts it once: whenever a run ends
 * stopped, the host runs again; whenever it waits, the host answers. `waitingAt` sees each wait
 * with the effects that had run by the end of the last stopped run.
 */
export async function driveInterrupted(
  scenario: MatrixScenario,
  world: World,
  first: Roundtable,
  stop: InProcessStop,
  mode: HostMode,
  settled: SettledEffect[],
  waitingAt: (
    requests: readonly { kind: string; data?: unknown }[],
    before: Record<string, number>,
  ) => void,
): Promise<{ room: Roundtable; result: RunResult; stopped: number }> {
  let room = first;
  let stopped = 0;
  let before = Object.fromEntries(world.effects);
  for (let rounds = 0; ; rounds++) {
    if (rounds > 40) throw new Error('The conversation never finished after being stopped');
    room = await stop.next(scenario, world, room);
    const result = await stop.run(room);
    if (result.status === 'cancelled' || result.status === 'limited') {
      stopped++;
      before = Object.fromEntries(world.effects);
      continue;
    }
    if (result.status !== 'waiting') return { room, result, stopped };
    waitingAt(result.requests, before);
    for (const request of result.requests) {
      room = await stop.next(scenario, world, room);
      await room.resume({
        requestId: request.id,
        responseId: `host:${request.id}`,
        expectedRevision: room.snapshot().revision,
        response: hostAnswer(world, request, mode, settled),
      });
    }
  }
}
