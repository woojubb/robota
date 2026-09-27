import { FunctionTool } from '@robota-sdk/agent-core';
import type { IExecutionJournal, IToolWithEventService, Robota } from '@robota-sdk/agent-core';
import type {
  RuntimeReference,
  SelectionContext,
  Selection,
  SelectorRegistration,
  TurnSelector,
} from '@robota-sdk/agent-roundtable';
import { meterJournal } from './metering-journal';
import { SelectorDecisionError } from './errors';

const DECISION_TOOL_NAME = 'decide_next_speaker';

export interface RobotaSelectorOptions {
  reference: RuntimeReference;
  createAgent(): Robota | Promise<Robota>;
  /** Reject a `parallel` decision naming more participants than this. Unset = no limit. */
  maxParallel?: number;
}

function discardingJournal(): IExecutionJournal {
  return { append: async () => {} };
}

function decisionTool(candidateIds: readonly string[]): IToolWithEventService {
  return new FunctionTool(
    {
      name: DECISION_TOOL_NAME,
      description:
        'Decide who speaks next in this conversation, or finish it. Call this exactly once.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['speak', 'finish'] },
          participantIds: {
            type: 'array',
            items: { type: 'string', enum: [...candidateIds] },
            description: 'One id to speak, several for a parallel group. Unused for "finish".',
          },
          reason: { type: 'string', description: 'Why this decision, or why the run finishes.' },
        },
        required: ['action'],
      },
    },
    async (args: Record<string, unknown>) => JSON.stringify(args),
  );
}

function renderContext(context: SelectionContext): string {
  const roster = context.participants
    .map((p) => `- ${p.id} (${p.kind}${p.description ? `: ${p.description}` : ''})`)
    .join('\n');
  const recent = context.turns
    .slice(-10)
    .map((t) => `- ${t.participantId}: ${t.outcome}`)
    .join('\n');
  return [
    'Decide who speaks next by calling the decision tool exactly once.',
    `Participants:\n${roster || '(none)'}`,
    `Recent turns:\n${recent || '(none yet)'}`,
    `Turns remaining this run: ${context.remainingTurns}`,
  ].join('\n\n');
}

interface Decision {
  action: 'speak' | 'finish';
  participantIds?: unknown;
  reason?: unknown;
}

function toSelection(
  decision: Decision,
  candidateIds: readonly string[],
  maxParallel: number | undefined,
): Selection {
  if (decision.action === 'finish') {
    return {
      kind: 'finish',
      reason: typeof decision.reason === 'string' ? decision.reason : 'done',
    };
  }
  if (decision.action !== 'speak')
    throw new SelectorDecisionError(
      'invalid-decision',
      `Unknown decision action: ${decision.action}`,
    );
  const ids = decision.participantIds;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string'))
    throw new SelectorDecisionError(
      'invalid-decision',
      'A speak decision requires participant ids',
    );
  const unique = new Set(ids);
  if (unique.size !== ids.length)
    throw new SelectorDecisionError(
      'invalid-decision',
      'A speak decision named the same participant twice',
    );
  if (maxParallel !== undefined && ids.length > maxParallel)
    throw new SelectorDecisionError(
      'invalid-decision',
      `A speak decision named more participants (${ids.length}) than maxParallel (${maxParallel})`,
    );
  const unknown = (ids as string[]).find((id) => !candidateIds.includes(id));
  if (unknown)
    throw new SelectorDecisionError('unknown-participant', `Unknown participant id: ${unknown}`);
  return ids.length === 1
    ? { kind: 'speak', participantId: ids[0] as string }
    : { kind: 'parallel', participantIds: ids as string[] };
}

/**
 * Select the next speaker(s) by asking a Robota agent to call one decision tool, exactly once.
 *
 * The agent `createAgent()` returns is built and reused for the selector's lifetime; it must
 * carry no tools of its own — the decision tool is the only one added, per call, scoped to that
 * call's candidate ids — because an agent free to call something else could never be trusted to
 * decide. Exactly one provider call is made per decision: `allowToolOnlyCompletion` and a
 * one-round cap keep the pipeline from forcing a second, follow-up call for a decision that
 * ends in a tool call rather than text. A decision this cannot resolve to exactly one `Selection`
 * — no call, more than one call, an unknown or duplicated participant id, an oversized parallel
 * group — throws `SelectorDecisionError` and fails the run; there is no retry.
 */
export function robotaSelector(options: RobotaSelectorOptions): TurnSelector {
  let agentPromise: Promise<Robota> | undefined;
  return {
    reference: options.reference,
    modelCalls: 'metered',
    async select(context, { signal, services }) {
      const candidateIds = context.participants.map((p) => p.id);
      if (candidateIds.length === 0)
        throw new SelectorDecisionError('no-candidates', 'No participants are available to select');
      if (!agentPromise) agentPromise = Promise.resolve(options.createAgent());
      const agent = await agentPromise;
      const existingTools = agent.getConfig().tools ?? [];
      if (existingTools.length > 0)
        throw new SelectorDecisionError(
          'invalid-decision',
          'The selector agent must carry no tools of its own',
        );
      await agent.updateTools([decisionTool(candidateIds)]);
      const before = agent.getHistory().length;
      const meteredJournal = meterJournal(discardingJournal(), services);
      await agent.run(renderContext(context), {
        signal,
        executionJournal: meteredJournal,
        maxExecutionRounds: 1,
        allowToolOnlyCompletion: true,
      });
      await agent.updateTools([]);
      const decisionCalls = agent
        .getHistory()
        .slice(before)
        .flatMap((message) =>
          message.role === 'assistant' && message.toolCalls ? message.toolCalls : [],
        )
        .filter((call) => call.function.name === DECISION_TOOL_NAME);
      if (decisionCalls.length === 0)
        throw new SelectorDecisionError('no-decision', 'The selector agent made no decision');
      if (decisionCalls.length > 1)
        throw new SelectorDecisionError(
          'multiple-decisions',
          'The selector agent made more than one decision',
        );
      let decision: Decision;
      try {
        decision = JSON.parse(decisionCalls[0]!.function.arguments) as Decision;
      } catch {
        throw new SelectorDecisionError(
          'invalid-decision',
          'Decision arguments were not valid JSON',
        );
      }
      return toSelection(decision, candidateIds, options.maxParallel);
    },
  };
}

/** `RoundtableRegistry.resolveSelector` entry for `robotaSelector`; the policy is stateless. */
export function robotaSelectorRegistration(options: RobotaSelectorOptions): SelectorRegistration {
  return {
    reference: options.reference,
    create: () => robotaSelector(options),
  };
}
