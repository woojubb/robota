import { loadRoundtable } from './load';
import { createRoundtable } from './index';
import { MemoryConversationStore } from './memory-store';
import type {
  ConversationClaim,
  ConversationCommit,
  ConversationEnvelope,
  ConversationStore,
} from './store-types';
import type {
  AgentParticipant,
  AttemptRecovery,
  AttemptRecoveryInput,
  CallSettlement,
  JsonValue,
  ParticipantCheckpoint,
  ParticipantResponse,
  ParticipantTurn,
  RoundtableOptions,
  Roundtable,
  RunResult,
  TurnSelector,
  TurnServices,
  UsageReport,
} from './types';

/**
 * Test harness for durable recovery. JavaScript cannot kill running code, so a "process generation"
 * is a set of handles whose every I/O hangs forever once the generation is killed; what it already
 * wrote stays on the shared disk, which is all a later generation sees.
 */

export const LEASE_MS = 100;

export type KillPlan =
  /** Kill after the n-th write to the conversation store (0 is its creation). */
  | { at: 'commit'; n: number; replyLost: boolean }
  /** Kill at the k-th journal append, which reaches the disk or not. */
  | { at: 'append'; k: number; written: boolean };

export type JournalEntry =
  /** Written before a call is admitted, so a refunded call is never retried under its own id. */
  | { t: 'intent'; callId: string }
  | { t: 'request'; callId: string }
  | { t: 'response'; callId: string; text: string }
  | { t: 'effect-start'; effectId: string; callId: string }
  | { t: 'effect-result'; effectId: string; result: string }
  | { t: 'done'; content: string };

const never = (): Promise<never> => new Promise(() => {});

/** The disk and the outside world: everything that outlives a process. */
export class World {
  skew = 0;
  readonly disk = new MemoryConversationStore({ now: () => Date.now() + this.skew });
  readonly journal = new Map<string, JournalEntry[]>();
  /** How many times each external effect actually ran. */
  readonly effects = new Map<string, number>();

  /** A new process; the previous one's claim is past its lease by the time this one starts. */
  generation(kill?: KillPlan): Generation {
    this.skew += LEASE_MS + 1;
    return new Generation(this, kill);
  }
}

class GatedStore implements ConversationStore {
  readonly durability = 'durable' as const;
  constructor(
    private readonly gen: Generation,
    private readonly disk: ConversationStore,
  ) {}

  private async read<T>(op: () => Promise<T>): Promise<T> {
    if (this.gen.killed) return never();
    return op();
  }

  private async write<T>(op: () => Promise<T>): Promise<T> {
    if (this.gen.killed) return never();
    const n = this.gen.writes++;
    if (n > 400) throw new Error('A generation is writing without end');
    const result = await op();
    const plan = this.gen.plan;
    if (plan?.at === 'commit' && plan.n === n) {
      this.gen.kill();
      if (plan.replyLost) return never();
    }
    return result;
  }

  create(id: string, state: JsonValue): Promise<ConversationEnvelope> {
    return this.write(() => this.disk.create(id, state));
  }
  load(id: string): Promise<ConversationEnvelope | undefined> {
    return this.read(() => this.disk.load(id));
  }
  claim(id: string, ownerId: string, leaseMs: number): Promise<ConversationClaim> {
    return this.read(() => this.disk.claim(id, ownerId, leaseMs));
  }
  renew(claim: ConversationClaim, leaseMs: number): Promise<ConversationClaim> {
    return this.read(() => this.disk.renew(claim, leaseMs));
  }
  release(claim: ConversationClaim): Promise<void> {
    return this.read(() => this.disk.release(claim));
  }
  commit(change: ConversationCommit): Promise<ConversationEnvelope> {
    return this.write(() => this.disk.commit(change));
  }
  lookupOperation(id: string, operationId: string): Promise<ConversationEnvelope | undefined> {
    return this.read(() => this.disk.lookupOperation(id, operationId));
  }
}

export class Generation {
  killed = false;
  writes = 0;
  appends = 0;
  readonly store: ConversationStore;
  private resolveKilled!: () => void;
  readonly whenKilled = new Promise<void>((resolve) => (this.resolveKilled = resolve));

  constructor(
    readonly world: World,
    readonly plan?: KillPlan,
  ) {
    this.store = new GatedStore(this, world.disk);
  }

  kill(): void {
    this.killed = true;
    this.resolveKilled();
  }

  async readJournal(scope: string): Promise<JournalEntry[]> {
    if (this.killed) return never();
    return structuredClone(this.world.journal.get(scope) ?? []);
  }

  async append(scope: string, entry: JournalEntry): Promise<void> {
    if (this.killed) return never();
    const k = this.appends++;
    const write = () => {
      const entries = this.world.journal.get(scope) ?? [];
      entries.push(structuredClone(entry));
      this.world.journal.set(scope, entries);
    };
    if (this.plan?.at === 'append' && this.plan.k === k) {
      if (this.plan.written) write();
      this.kill();
      return never();
    }
    write();
  }

  async runEffect(effectId: string): Promise<string> {
    if (this.killed) return never();
    this.world.effects.set(effectId, (this.world.effects.get(effectId) ?? 0) + 1);
    return `paid:${effectId}`;
  }
}

const BOUND = { inputTokens: 10, maxOutputTokens: 20 };
const modelReport = (callId: string): UsageReport => ({
  callId,
  outcome: 'completed',
  provenance: 'reported',
  tokens: { input: 10, output: 20 },
  final: true,
});
const effectReport = (callId: string): UsageReport => ({
  callId,
  outcome: 'completed',
  provenance: 'reported',
  tokens: { input: 5, output: 0 },
  final: true,
});

function turnsOf(checkpoint: ParticipantCheckpoint | null): number {
  return (checkpoint?.data as { turns?: number } | undefined)?.turns ?? 0;
}
const checkpointAt = (turns: number): ParticipantCheckpoint => ({ version: '1', data: { turns } });

/** Replaces a real answer with one a journal would never give. */
export type Tamper = (answer: AttemptRecovery, input: AttemptRecoveryInput) => AttemptRecovery;

/** Whether this participant's turn fails after its model call, for the failing scenario. */
export type FailurePolicy = (participantId: string, seen: readonly string[]) => boolean;

/** What a participant says and which effect it causes are pure functions of what it was shown. */
function replyTo(participantId: string, seen: readonly string[]): string {
  return `${participantId} replies to ${seen.length ? seen.join(' / ') : 'nothing'}`;
}
function effectOf(participantId: string, seen: readonly string[]): string {
  return `${participantId}|${seen.join('|')}`;
}

/**
 * A participant with a durable journal of its own: model call, paid effect, completion, each journaled
 * before and after it happens, which is what a real runtime's journal would let `reconcile` read back.
 */
export function scriptedAgent(
  gen: Generation,
  id: string,
  options: {
    failure?: FailurePolicy;
    tamper?: Tamper;
  } = {},
): AgentParticipant {
  const scope = (turn: ParticipantTurn) => `${turn.participantId}/${turn.attemptId}`;

  async function drive(
    turn: ParticipantTurn,
    services: TurnServices,
    responses: readonly ParticipantResponse[] | undefined,
    turnsBefore: number,
  ): Promise<{ kind: 'speak'; content: string; turnsAfter: number }> {
    const key = scope(turn);
    const seen = turn.context.messages.map((message) => message.content);
    let entries = await gen.readJournal(key);
    let text = entries.find((entry) => entry.t === 'response')?.text;
    if (text === undefined) {
      const callId = `model:${turn.attemptId}:${entries.filter((e) => e.t === 'intent' && e.callId.startsWith('model:')).length}`;
      await gen.append(key, { t: 'intent', callId });
      await services.admitModelCall({ callId, providerId: 'script', modelId: 'm', bound: BOUND });
      await gen.append(key, { t: 'request', callId });
      text = replyTo(turn.participantId, seen);
      await gen.append(key, { t: 'response', callId, text });
      await services.recordUsage(modelReport(callId));
    }
    if (options.failure?.(turn.participantId, seen)) throw new Error('scripted failure');
    entries = await gen.readJournal(key);
    const effectId = effectOf(turn.participantId, seen);
    let result = entries.find((entry) => entry.t === 'effect-result')?.result;
    if (result === undefined) {
      let callId = '';
      const started = entries.some((entry) => entry.t === 'effect-start');
      let settled: string | null = null;
      if (started) {
        // The host settled an effect that started without a result: its answer is the result, or
        // null when the host proved the effect never ran and it is safe to run now.
        const answer = responses?.find((response) => response.response.kind === 'reconciliation');
        if (!answer || answer.response.kind !== 'reconciliation')
          throw new Error('An effect started without a result needs the host');
        settled = (answer.response.data as { result: string | null }).result;
      } else {
        const tries = entries.filter(
          (e) => e.t === 'intent' && e.callId.startsWith('tool-effect:'),
        );
        callId = `tool-effect:${effectId}:${tries.length}`;
        await gen.append(key, { t: 'intent', callId });
        await services.admitToolEffect({ callId, toolName: 'pay', tokens: 5 });
        await gen.append(key, { t: 'effect-start', effectId, callId });
      }
      result = settled ?? (await gen.runEffect(effectId));
      await gen.append(key, { t: 'effect-result', effectId, result });
      if (!started) await services.recordUsage(effectReport(callId));
    }
    const content = `${text} + ${result}`;
    await gen.append(key, { t: 'done', content });
    return { kind: 'speak', content, turnsAfter: turnsBefore + 1 };
  }

  async function reconcile(input: {
    turn: ParticipantTurn;
    checkpoint: ParticipantCheckpoint | null;
    reservedCalls: readonly { callId: string; kind: string }[];
  }): Promise<AttemptRecovery> {
    const entries = await gen.readJournal(scope(input.turn));
    const calls: CallSettlement[] = input.reservedCalls.map(({ callId }): CallSettlement => {
      const response = entries.find((e) => e.t === 'response' && e.callId === callId);
      if (response) return { kind: 'settled', callId, report: modelReport(callId) };
      const effect = entries.find((e) => e.t === 'effect-start' && e.callId === callId);
      const result = effect && entries.find((e) => e.t === 'effect-result');
      if (result) return { kind: 'settled', callId, report: effectReport(callId) };
      if (effect || entries.some((e) => e.t === 'request' && e.callId === callId))
        return { kind: 'uncertain', callId };
      return { kind: 'not-dispatched', callId };
    });
    const turns = turnsOf(input.checkpoint);
    const done = entries.find((entry) => entry.t === 'done');
    if (done) {
      return {
        kind: 'settled',
        outcome: { kind: 'speak', content: done.content },
        checkpoint: checkpointAt(turns + 1),
        calls,
      };
    }
    const started = entries.find((entry) => entry.t === 'effect-start');
    if (started && !entries.some((entry) => entry.t === 'effect-result')) {
      return {
        kind: 'uncertain',
        requests: [
          {
            id: `reconcile:${started.effectId}`,
            kind: 'reconciliation',
            reason: 'An effect started without a result',
            data: { effectId: started.effectId },
          },
        ],
        checkpoint: checkpointAt(turns),
        calls,
      };
    }
    if (entries.every((entry) => entry.t === 'intent')) return { kind: 'not-started', calls };
    return { kind: 'resume', checkpoint: checkpointAt(turns), calls };
  }

  return {
    kind: 'agent',
    id,
    runtime: { id, version: '1' },
    factory: {
      recovery: 'reconcilable',
      supportsContinuation: true,
      checkpointVersions: ['1'],
      modelCalls: 'enforced',
      reconcile: async (input) => {
        const answer = await reconcile(input);
        return options.tamper ? options.tamper(answer, input) : answer;
      },
      openSession: async ({ checkpoint }) => {
        let turns = turnsOf(checkpoint ?? null);
        return {
          release: async () => {},
          session: {
            checkpoint: async () => checkpointAt(turns),
            runTurn: async (turn, { services }) => {
              const done = await drive(turn, services, undefined, turns);
              turns = done.turnsAfter;
              return { kind: 'speak', content: done.content };
            },
            resumeTurn: async (turn, responses, { services }) => {
              const done = await drive(turn, services, responses, turns);
              turns = done.turnsAfter;
              return { kind: 'speak', content: done.content };
            },
          },
        };
      },
    },
  };
}

/** A selector that is a function of the transcript: finishes after `total` turns. */
export function finishingSelector(
  total: number,
  next: (
    turns: number,
  ) => { kind: 'speak'; participantId: string } | { kind: 'parallel'; participantIds: string[] },
): TurnSelector {
  return {
    reference: { id: 'harness/finishing', version: '1' },
    modelCalls: 'none',
    recovery: 'reconcilable',
    idempotentDecision: true,
    select: ({ turns }) =>
      turns.length >= total ? { kind: 'finish', reason: 'done' } : next(turns.length),
  };
}

export interface Scenario {
  conversationId: string;
  agents: string[];
  /** The built-in round-robin selector when omitted. */
  selector?: TurnSelector;
  failure?: FailurePolicy;
  tamper?: Tamper;
  concurrency?: number;
  maxTurnsPerRun?: number;
}

function options(scenario: Scenario, gen: Generation): RoundtableOptions {
  return {
    conversationId: scenario.conversationId,
    store: gen.store,
    recovery: 'durable',
    leaseMs: LEASE_MS,
    ...(scenario.selector ? { selector: scenario.selector } : {}),
    participants: scenario.agents.map((id) =>
      scriptedAgent(gen, id, {
        ...(scenario.failure ? { failure: scenario.failure } : {}),
        ...(scenario.tamper ? { tamper: scenario.tamper } : {}),
      }),
    ),
    limits: { maxTurnsPerRun: scenario.maxTurnsPerRun ?? 8 },
    maxConcurrentParticipants: scenario.concurrency ?? 1,
    budget: { tokens: 100_000, mode: 'strict' },
  };
}

export function createIn(scenario: Scenario, gen: Generation): Roundtable {
  return createRoundtable(options(scenario, gen));
}

export function loadIn(scenario: Scenario, gen: Generation): Promise<Roundtable> {
  const opts = options(scenario, gen);
  const agents = new Map(
    (opts.participants as AgentParticipant[]).map((participant) => [participant.id, participant]),
  );
  return loadRoundtable({
    conversationId: scenario.conversationId,
    store: gen.store,
    registry: {
      resolveParticipant: (reference) => ({
        reference,
        factory: agents.get(reference.id)!.factory,
      }),
      resolveSelector: (reference) => ({ reference, create: () => scenario.selector! }),
    },
  });
}

export type Outcome = { killed: true } | { killed: false; result: RunResult };

/** Runs until it finishes or the generation is killed; a killed run never settles, so it is abandoned. */
export async function runUntilKilled(gen: Generation, room: Roundtable): Promise<Outcome> {
  const run = room.run();
  run.catch(() => {});
  return Promise.race([
    run.then((result) => ({ killed: false as const, result })),
    gen.whenKilled.then(() => ({ killed: true as const })),
  ]);
}

/**
 * The host's side after a restart: settle every parked reconciliation from what the outside world
 * shows (the effect ran, or provably did not), then run again, until the conversation stops waiting.
 */
export async function finish(
  world: World,
  room: Roundtable,
  first: RunResult,
): Promise<Exclude<RunResult, { status: 'waiting' }>> {
  let result = first;
  for (let rounds = 0; result.status === 'waiting'; rounds++) {
    if (rounds > 8) throw new Error('The conversation keeps waiting after the host settled it');
    for (const request of result.requests) {
      if (request.kind !== 'reconciliation') throw new Error(`Unexpected request ${request.kind}`);
      const { effectId } = request.data as { effectId: string };
      const ran = (world.effects.get(effectId) ?? 0) > 0;
      await room.resume({
        requestId: request.id,
        responseId: `settle:${request.id}`,
        expectedRevision: room.snapshot().revision,
        response: { kind: 'reconciliation', data: { result: ran ? `paid:${effectId}` : null } },
      });
    }
    result = await room.run();
  }
  return result;
}
