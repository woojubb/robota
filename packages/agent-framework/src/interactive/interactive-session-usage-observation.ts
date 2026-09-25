import { calculateModelCost } from '@robota-sdk/agent-core';

import type { IUsageSnapshot } from './types.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IUsageModelShare, IUsageObservation } from '@robota-sdk/agent-interface-analytics';
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
  modelShares?: readonly IUsageModelShare[];
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
      ...(input.modelShares ? { modelShares: input.modelShares } : {}),
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
    /** Which model answered, from the turn's own calls; see {@link attributeTurnModels}. */
    attribution?: ITurnModelAttribution;
  },
): void {
  const { attribution, ...observation } = input;
  const shares = attribution?.modelShares;
  // A turn split across models names none of them alone; its shares say who spent what.
  const providerId =
    shares !== undefined
      ? undefined
      : (attribution?.answeredBy?.providerId ?? session.getProviderId?.());
  const modelId =
    shares !== undefined ? undefined : (attribution?.answeredBy?.modelId ?? session.getModelId?.());
  history.push(
    createUsageObservationEntry({
      ...observation,
      ...(providerId ? { providerId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(shares !== undefined ? { modelShares: shares } : {}),
    }),
  );
}

/** Who answered a turn: one model, or each model's part when it ran on more than one. */
export interface ITurnModelAttribution {
  answeredBy?: { providerId: string; modelId: string };
  modelShares?: IUsageModelShare[];
}

/** The per-call facts the attribution reads. */
export interface ITurnModelCall {
  outcome: string;
  disposition?: string;
  providerId?: string;
  modelId?: string;
  usageProvenance?: string;
  promptTokens?: number;
  completionTokens?: number;
}

/**
 * Attribute a turn from the calls that answered in it. A turn on one model names it; a turn that
 * moved between models gets one share per model, with only that model's tokens and cost.
 */
export function attributeTurnModels(calls: readonly ITurnModelCall[]): ITurnModelAttribution {
  const byModel = new Map<
    string,
    { providerId: string; modelId: string; calls: ITurnModelCall[] }
  >();
  for (const call of calls) {
    if (call.outcome !== 'success' || call.disposition !== 'invoked') continue;
    if (call.providerId === undefined || call.modelId === undefined) continue;
    const key = `${call.providerId}\u0000${call.modelId}`;
    const group = byModel.get(key) ?? {
      providerId: call.providerId,
      modelId: call.modelId,
      calls: [],
    };
    group.calls.push(call);
    byModel.set(key, group);
  }
  const groups = [...byModel.values()];
  if (groups.length === 0) return {};
  if (groups.length === 1) {
    return { answeredBy: { providerId: groups[0]!.providerId, modelId: groups[0]!.modelId } };
  }
  return {
    modelShares: groups.map(({ providerId, modelId, calls: modelCalls }) => {
      let promptTokens = 0;
      let completionTokens = 0;
      let complete = true;
      for (const call of modelCalls) {
        if (
          call.usageProvenance !== 'complete' ||
          call.promptTokens === undefined ||
          call.completionTokens === undefined
        ) {
          complete = false;
          continue;
        }
        promptTokens += call.promptTokens;
        completionTokens += call.completionTokens;
      }
      const cost = complete
        ? calculateModelCost(modelId, promptTokens, completionTokens)
        : undefined;
      const priced = cost !== undefined && Number.isFinite(cost) && cost >= 0;
      return {
        providerId,
        modelId,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        costStatus: priced ? ('estimated' as const) : ('unknown' as const),
        ...(priced ? { costUsd: cost } : {}),
      };
    }),
  };
}
