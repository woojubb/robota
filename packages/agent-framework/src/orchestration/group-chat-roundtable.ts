import { MemoryConversationStore } from '@robota-sdk/agent-roundtable';

import { runStepOnce, threadPrompt } from './shared';

import type {
  IGroupChatOrchestrationSpec,
  IOrchestrationStep,
  IOrchestrationStepResult,
  ITokenUsage,
} from '@robota-sdk/agent-core';
import type {
  AgentParticipant,
  ConversationSnapshot,
  JsonValue,
  Roundtable,
  RoundtableOptions,
  Selection,
  TurnSelector,
} from '@robota-sdk/agent-roundtable';
import type { IStepRunDeps, OrchestrationEmit } from './shared';

/**
 * The neutral turn-selection policy the facade wraps into a `TurnSelector` (SELFHOST-001 P3 —
 * moved here, unchanged, from `group-chat.ts`; re-exported there for the existing public path).
 */
export type SelectNextStep = (
  history: IOrchestrationStepResult[],
  lastStepId: string,
) => string | null;

/**
 * Assigned once `createRoundtable` returns; the selector and every participant read it mid-run
 * (`rt.current!.snapshot()`) to render the whole transcript, exactly as the old while-loop threaded
 * `stepResults` forward — a `Roundtable` cannot be constructed with a participant that already
 * needs to call back into it, so this ref closes that cycle.
 */
export interface GroupChatRoundtableRef {
  current?: Roundtable;
}

/**
 * Records the FIRST error thrown by our own selector or participant code during one `rt.run()`.
 * The core converts a throw into a stringified `{status:'failed', message}`, losing the original
 * object; the facade rethrows this captured reference instead so callers keep `instanceof`/`toBe`.
 */
export interface GroupChatErrorBox {
  has: boolean;
  error?: unknown;
}

/** Render the prior turns as neutral, id-labeled history threaded into the next step's prompt. */
function renderHistory(stepResults: IOrchestrationStepResult[]): string {
  return stepResults.map((result) => `[${result.id}] ${result.output}`).join('\n\n');
}

/**
 * Convert a Roundtable snapshot's published messages into the legacy `IOrchestrationStepResult[]`
 * shape: one entry per turn, in publication order, with usage read back from the settled ledger
 * record sharing that turn's id (the raw {@link ITokenUsage} recorded by {@link createGroupChatParticipants}).
 */
export function toStepResults(snapshot: ConversationSnapshot): IOrchestrationStepResult[] {
  return snapshot.messages.map((message): IOrchestrationStepResult => {
    const record = snapshot.usage.find((entry) => entry.turnId === message.turnId);
    const usage =
      record && record.status === 'settled' && record.raw !== undefined
        ? (record.raw as unknown as ITokenUsage)
        : undefined;
    return { id: message.participantId, output: message.content, ...(usage ? { usage } : {}) };
  });
}

/**
 * Pure decision, shared by every turn (including the first): `next` is either the initial pick
 * (`firstStepId ?? steps[0]?.id`, turn 1) or the legacy `selectNextStep`'s return value (later
 * turns). Reproduces the old `while (currentId) { if (over maxTurns) throw; if (unknown) throw; }`
 * loop guard exactly, including its check ORDER — a bound breach wins over an unknown id — and its
 * numeric quirks for a non-finite/fractional `maxTurns` (unclamped, unlike the core's own
 * `limits.maxTurnsPerRun`; see {@link toRoundtableOptions}).
 */
export function decide(
  turnCount: number,
  next: string | null,
  maxTurns: number,
  ids: ReadonlySet<string>,
): { kind: 'finish' } | { kind: 'speak'; id: string } {
  if (!next) return { kind: 'finish' };
  if (turnCount >= maxTurns) throw new Error(`group-chat exceeded maxTurns (${maxTurns})`);
  if (!ids.has(next)) throw new Error(`group-chat step not found: ${next}`);
  return { kind: 'speak', id: next };
}

/**
 * The `TurnSelector` adapter: on the first turn (`context.turns.length === 0`) it picks
 * `firstId` directly, WITHOUT calling the legacy `selectNextStep` (matching the old loop's initial
 * `currentId` assignment); on every later turn it calls `selectNextStep(history, lastStepId)` and
 * feeds the result through {@link decide}. Synchronous, like the legacy policy it wraps. Declares
 * `modelCalls: 'none'` — the selection itself makes no model call.
 */
export function createGroupChatSelector(
  ids: ReadonlySet<string>,
  firstId: string | null,
  maxTurns: number,
  selectNextStep: SelectNextStep,
  rt: GroupChatRoundtableRef,
  errorBox: GroupChatErrorBox,
): TurnSelector {
  return {
    reference: { id: 'robota-sdk/group-chat-selector', version: '1' },
    modelCalls: 'none',
    select(context): Selection {
      try {
        let next: string | null;
        if (context.turns.length === 0) {
          next = firstId;
        } else {
          const lastStepId = context.turns[context.turns.length - 1].participantId;
          const history = toStepResults(rt.current!.snapshot());
          next = selectNextStep(history, lastStepId);
        }
        const decision = decide(context.turns.length, next, maxTurns, ids);
        return decision.kind === 'finish'
          ? { kind: 'finish', reason: 'group-chat: selector ended the run' }
          : { kind: 'speak', participantId: decision.id };
      } catch (error) {
        if (!errorBox.has) {
          errorBox.has = true;
          errorBox.error = error;
        }
        throw error;
      }
    },
  };
}

/**
 * One `AgentParticipant` per step id in `byId`, each a compatibility shim whose `runTurn`: reads
 * the whole transcript so far off `rt` (never off `turn.context.messages`, which carries only
 * unseen messages — never the participant's own prior output), builds the same threaded prompt the
 * old loop built, admits a model-call intent, spawns and waits over `runStepOnce` (the SAME helper
 * `sequential`/`parallel`/… use, so STEP_STARTED/STEP_COMPLETED and the spawn request are
 * byte-identical to before), then records any usage the manager reported. `release` is a no-op —
 * this shim keeps no session state and never checkpoints, so it never yields or waits.
 */
export function createGroupChatParticipants(
  byId: ReadonlyMap<string, IOrchestrationStep>,
  deps: IStepRunDeps,
  runId: string,
  emit: OrchestrationEmit,
  rt: GroupChatRoundtableRef,
  errorBox: GroupChatErrorBox,
): AgentParticipant[] {
  return [...byId.entries()].map(([id, step]): AgentParticipant => ({
    kind: 'agent',
    id,
    runtime: { id: 'robota-sdk/group-chat-step', version: '1' },
    factory: {
      modelCalls: 'metered',
      openSession: async () => ({
        session: {
          runTurn: async (turn, options) => {
            try {
              const history = toStepResults(rt.current!.snapshot());
              const prompt = threadPrompt(step.prompt, renderHistory(history));
              await options.services.admitModelCall({
                callId: turn.attemptId,
                providerId: 'robota-subagent',
                modelId: step.model ?? step.agentType,
              });
              const result = await runStepOnce(step, history.length, prompt, deps, runId, emit);
              if (result.usage) {
                await options.services.recordUsage({
                  callId: turn.attemptId,
                  outcome: 'completed',
                  provenance: 'reported',
                  final: true,
                  raw: result.usage as unknown as JsonValue,
                });
              }
              return { kind: 'speak', content: result.output };
            } catch (error) {
              if (!errorBox.has) {
                errorBox.has = true;
                errorBox.error = error;
              }
              throw error;
            }
          },
        },
        release: async () => {},
      }),
    },
  }));
}

/** A finite `maxTurns` allows the core one MORE turn than {@link decide} does, so `decide`'s own
 * bound check always fires before the core's own `limited` status could — the core's limit exists
 * only to satisfy its constructor validation, and is engineered here to never actually bind. A
 * non-finite `maxTurns` (NaN/Infinity) cannot be a safe integer either, so it maps to the largest
 * one instead — practically unbounded, matching the old loop's own numeric comparison, which never
 * threw for a non-finite bound.
 */
function toMaxTurnsPerRun(maxTurns: number): number {
  return Number.isFinite(maxTurns) ? Math.max(1, Math.ceil(maxTurns) + 1) : Number.MAX_SAFE_INTEGER;
}

/**
 * Build the `RoundtableOptions` for one `runGroupChat` call: a fresh in-memory store, one
 * `AgentParticipant` per unique non-empty step id (the LAST definition for a repeated id wins, by
 * plain `Map` insertion), single-file concurrency (`maxConcurrentParticipants: 1`, matching the old
 * loop's one-turn-at-a-time contract), and `recovery: 'none'` (this facade makes no durability
 * claim). `rt`/`errorBox` are supplied by the caller and threaded into both the participants and the
 * selector, since they close over the very `Roundtable` this call is building options for.
 */
export function toRoundtableOptions(
  spec: IGroupChatOrchestrationSpec,
  deps: IStepRunDeps,
  runId: string,
  emit: OrchestrationEmit,
  selectNextStep: SelectNextStep,
  rt: GroupChatRoundtableRef,
  errorBox: GroupChatErrorBox,
): RoundtableOptions {
  const byId = new Map(
    spec.steps.filter((step) => step.id).map((step) => [step.id, step] as const),
  );
  const ids = new Set(byId.keys());
  const maxTurns = spec.maxTurns ?? spec.steps.length;
  const firstId = spec.firstStepId ?? spec.steps[0]?.id ?? null;
  return {
    conversationId: runId,
    participants: createGroupChatParticipants(byId, deps, runId, emit, rt, errorBox),
    selector: createGroupChatSelector(ids, firstId, maxTurns, selectNextStep, rt, errorBox),
    limits: { maxTurnsPerRun: toMaxTurnsPerRun(maxTurns) },
    maxConcurrentParticipants: 1,
    store: new MemoryConversationStore(),
    recovery: 'none',
  };
}
