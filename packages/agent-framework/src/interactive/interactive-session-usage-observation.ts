import type { IUsageSnapshot } from './types.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IUsageObservation } from '@robota-sdk/agent-interface-analytics';
import type { Session } from '@robota-sdk/agent-session';

function usageSurface(driverId: string | undefined): IUsageObservation['surface'] {
  if (driverId === 'app') return 'desktop-app';
  if (driverId?.includes('browser') || driverId?.includes('web')) return 'browser';
  if (driverId?.startsWith('peer:') || driverId?.startsWith('remote')) return 'remote';
  if (driverId === undefined || driverId === 'owner') return 'cli';
  return 'unknown';
}

/** DATA-2577: project a started turn into the canonical content-free analytics observation. */
export function createUsageObservationEntry(input: {
  turnId: string;
  outcome: IUsageObservation['outcome'];
  promptExecutionStartedAt?: string;
  promptExecutionEndedAt?: string;
  promptExecutionOutcome?: IUsageObservation['outcome'];
  promptExecutionTraceId?: string;
  promptExecutionSpanId?: string;
  providerId?: string;
  modelId?: string;
  driverId?: string;
  surface?: IUsageObservation['surface'];
  usage?: IUsageSnapshot;
}): IHistoryEntry<IUsageObservation> {
  return {
    id: `usage-observation_${input.turnId}`,
    timestamp: new Date(),
    category: 'event',
    type: 'usage-observation',
    data: {
      usageObservationId: input.turnId,
      turnId: input.turnId,
      outcome: input.outcome,
      ...(input.promptExecutionStartedAt
        ? { promptExecutionStartedAt: input.promptExecutionStartedAt }
        : {}),
      ...(input.promptExecutionEndedAt
        ? { promptExecutionEndedAt: input.promptExecutionEndedAt }
        : {}),
      ...(input.promptExecutionOutcome
        ? { promptExecutionOutcome: input.promptExecutionOutcome }
        : {}),
      ...(input.promptExecutionTraceId
        ? { promptExecutionTraceId: input.promptExecutionTraceId }
        : {}),
      ...(input.promptExecutionSpanId
        ? { promptExecutionSpanId: input.promptExecutionSpanId }
        : {}),
      surface: input.surface ?? usageSurface(input.driverId),
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.modelId ? { modelId: input.modelId } : {}),
      ...(input.usage ? { usage: input.usage } : {}),
      ...(input.usage?.source ? { source: input.usage.source } : {}),
    },
  };
}

/** Append one content-free observation for a top-level turn that acquired the execution claim. */
export function recordUsageObservation(
  history: IHistoryEntry[],
  session: Session,
  input: {
    turnId: string;
    outcome: IUsageObservation['outcome'];
    promptExecutionStartedAt?: string;
    promptExecutionEndedAt?: string;
    promptExecutionOutcome?: IUsageObservation['outcome'];
    promptExecutionTraceId?: string;
    promptExecutionSpanId?: string;
    driverId?: string;
    surface?: IUsageObservation['surface'];
    usage?: IUsageSnapshot;
    /** The provider and model that answered, when a call reported them; the session's otherwise. */
    answeredBy?: { providerId: string; modelId: string };
  },
): void {
  const { answeredBy, ...observation } = input;
  const providerId = answeredBy?.providerId ?? session.getProviderId?.();
  const modelId = answeredBy?.modelId ?? session.getModelId?.();
  history.push(
    createUsageObservationEntry({
      ...observation,
      ...(providerId ? { providerId } : {}),
      ...(modelId ? { modelId } : {}),
    }),
  );
}
