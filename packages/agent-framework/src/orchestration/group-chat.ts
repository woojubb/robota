import { ORCHESTRATION_EVENTS } from '@robota-sdk/agent-core';
import { createRoundtable } from '@robota-sdk/agent-roundtable';

import { makeEmit } from './shared';
import {
  decide,
  toRoundtableOptions,
  toStepResults,
  type GroupChatErrorBox,
  type GroupChatRoundtableRef,
  type SelectNextStep,
} from './group-chat-roundtable';

import type {
  IGroupChatOrchestrationSpec,
  IOrchestrationRunResult,
  IEventService,
} from '@robota-sdk/agent-core';
import type { ISubagentManager } from '@robota-sdk/agent-executor';
import type { IOrchestrationRunContext } from './shared';

export type { SelectNextStep } from './group-chat-roundtable';

/**
 * Dependencies for the `group-chat` orchestration mechanism. Adds the neutral
 * `selectNextStep` policy to the shared manager/context/events surface.
 */
export interface IGroupChatOrchestratorDeps {
  /** The subagent manager (over `ISubagentRunner`) that runs each step. */
  manager: ISubagentManager;
  /** Run context threaded into each spawned subagent request. */
  context: IOrchestrationRunContext;
  /** Optional event service; when present, lifecycle events are emitted. */
  events?: IEventService;
  /** Caller-supplied policy selecting the next step to take a turn (or `null` to end). */
  selectNextStep: SelectNextStep;
}

/** Monotonic per-process counter so concurrent runs in one session get distinct run ids. */
let groupChatRunCounter = 0;

/**
 * Run a `group-chat` (turn-taking) orchestration: starting at `firstStepId` (or
 * the first step), each selected step takes a turn — threaded the prior turns'
 * outputs — then the injected `selectNextStep` policy picks who goes next, `null`
 * ending the run. A `maxTurns` bound (default: step count) guards a policy that
 * never ends; exceeding it fails the run. Returns the per-step results in turn
 * order plus the last turn's output. Emits neutral lifecycle events.
 *
 * A facade over `@robota-sdk/agent-roundtable`'s `Roundtable`: the core owns the only turn loop
 * here (see `group-chat-roundtable.ts`) — this function itself holds no transcript, turn counter or
 * `while` loop, only the STARTED/COMPLETED/FAILED lifecycle around one `Roundtable` run.
 */
export async function runGroupChat(
  spec: IGroupChatOrchestrationSpec,
  deps: IGroupChatOrchestratorDeps,
): Promise<IOrchestrationRunResult> {
  groupChatRunCounter += 1;
  const runId = `${deps.context.parentSessionId}:groupchat:${groupChatRunCounter}`;
  const emit = makeEmit(deps.events, 'group-chat');
  emit(ORCHESTRATION_EVENTS.STARTED, runId, {});

  try {
    const nonEmptyIds = new Set(spec.steps.filter((step) => step.id).map((step) => step.id));
    const maxTurns = spec.maxTurns ?? spec.steps.length;
    const firstId = spec.firstStepId ?? spec.steps[0]?.id ?? null;

    if (nonEmptyIds.size === 0) {
      // No step can ever be reached (the core refuses to be built with zero participants): run the
      // same pure decision the core's selector would, without ever constructing a Roundtable. Given
      // an empty id set, `decide` either finishes (a falsy `firstId`) or throws "step not found" —
      // it can never resolve to `speak`.
      decide(0, firstId, maxTurns, nonEmptyIds);
      emit(ORCHESTRATION_EVENTS.COMPLETED, runId, {});
      return { primitive: 'group-chat', steps: [], output: '' };
    }

    const rtRef: GroupChatRoundtableRef = {};
    const errorBox: GroupChatErrorBox = { has: false };
    const options = toRoundtableOptions(
      spec,
      deps,
      runId,
      emit,
      deps.selectNextStep,
      rtRef,
      errorBox,
    );
    const rt = createRoundtable(options);
    rtRef.current = rt;
    try {
      const result = await rt.run();
      if (result.status === 'failed') {
        throw errorBox.has ? errorBox.error : new Error(result.message);
      }
      if (result.status !== 'completed') {
        // `limited`/`cancelled`/`waiting` cannot happen: no time/model-call limit is configured,
        // nothing external ever calls `dispose()` mid-run, and no participant ever waits.
        throw new Error(
          `group-chat: internal invariant violated — roundtable status ${result.status}`,
        );
      }
      const steps = toStepResults(rt.snapshot());
      const output = steps.length > 0 ? steps[steps.length - 1].output : '';
      emit(ORCHESTRATION_EVENTS.COMPLETED, runId, {});
      return { primitive: 'group-chat', steps, output };
    } finally {
      await rt.dispose();
    }
  } catch (error) {
    emit(ORCHESTRATION_EVENTS.FAILED, runId, {
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
