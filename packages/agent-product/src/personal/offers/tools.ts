/**
 * The task-offer tool: the agent proposes that the person run one of the host's installed tasks
 * because of something it read. It names a task, the source it saw and why; it cannot publish a task,
 * grant a capability or start anything, since all it does is hand the proposal to a port the host
 * supplies and report the answer. The host checks every proposal and the person decides every offer,
 * so this is a tool a run that reads untrusted content may have, like the case tools.
 */
import { registerToolPermissionProfile } from '@robota-sdk/agent-core';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

import type { FunctionTool, TUniversalValue } from '@robota-sdk/agent-core';
import type { IOfferProposer } from './types.js';

export const OFFER_TOOL_NAMES = { propose: 'TaskOfferPropose' } as const;

/** Declared on every build: registration merges, and a host that cleared the registry gets it back. */
function registerProfiles(): void {
  // Inspect-class on purpose, as for the case tools: plan mode refuses every other class, and a
  // read-only run must still be able to make a proposal. It reaches nothing outside the agent's own
  // state, and the host's gate stands between a proposal and anything the person sees.
  registerToolPermissionProfile(OFFER_TOOL_NAMES.propose, { riskClass: 'inspect' });
}

export function createOfferTools(proposer: IOfferProposer): FunctionTool[] {
  registerProfiles();
  return [
    createZodFunctionTool(
      OFFER_TOOL_NAMES.propose,
      'Propose that the person run one of their installed tasks because of something you just read: a link in a mail, a note. Name the task (its id and revision), where you read it (`source`: kind, the connector id and the item reference for a connected service, and when you read it as a UTC time such as 2026-01-31T09:00:00Z), a short factual `basis` for what the source says, and in `why` one short sentence on why acting now may help. `suggestedInputs` may carry values for the task to start with; the person reads and changes them. You cannot start a task or change what it may do: the host checks the proposal, and the person decides. The answer says whether it was accepted or why not; when it is rejected, stop: do not try to word it differently.',
      z.object({
        definitionId: z.string().min(1),
        definitionRevision: z.number().int().positive(),
        source: z.object({
          kind: z.string().min(1),
          connectorId: z.string().optional(),
          sourceItemId: z.string().optional(),
          observedAt: z.string().min(1),
        }),
        basis: z.string().min(1),
        why: z.string().min(1),
        suggestedInputs: z.record(z.string(), z.string()).optional(),
      }),
      async (candidate): Promise<TUniversalValue> => {
        const { source, suggestedInputs, ...rest } = candidate;
        const answer = await proposer.propose({
          ...rest,
          source: {
            kind: source.kind,
            ...(source.connectorId !== undefined && { connectorId: source.connectorId }),
            ...(source.sourceItemId !== undefined && { sourceItemId: source.sourceItemId }),
            observedAt: source.observedAt,
          },
          ...(suggestedInputs !== undefined && { suggestedInputs }),
        });
        return answer.status === 'accepted'
          ? { status: 'accepted', offerId: answer.offerId }
          : { status: 'rejected', reason: answer.reason };
      },
    ),
  ];
}
