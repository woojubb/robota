import { collectAssistantUsageMetadata, verifiedProviderCallUsage } from '@robota-sdk/agent-core';
import type {
  IExecutionJournal,
  IRecoverableExecutionJournal,
  TExecutionJournalRecord,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import type { TurnServices, UsageProvenance, UsageReport } from '@robota-sdk/agent-roundtable';

function usageReport(
  callId: string,
  outcome: UsageReport['outcome'],
  response: TUniversalMessage,
): UsageReport {
  const verified = verifiedProviderCallUsage(response);
  const provenance: UsageProvenance =
    verified.provenance === 'complete'
      ? 'reported'
      : verified.provenance === 'partial'
        ? 'partial'
        : 'unknown';
  const usage = collectAssistantUsageMetadata(response);
  return {
    callId,
    outcome,
    provenance,
    ...(usage
      ? {
          tokens: {
            input: usage.inputTokens,
            output: usage.outputTokens,
            ...(usage.cacheReadTokens !== undefined ? { cacheRead: usage.cacheReadTokens } : {}),
          },
        }
      : {}),
    final: true,
  };
}

/**
 * The metering behaviour shared by `meterJournal` and `meterRecoverableJournal`.
 *
 * `callJournaledProvider` (agent-core) writes a `model-request`/`model-cache-hit` record and
 * awaits it before every provider dispatch, so admitting inside `append`, before it reaches the
 * inner journal, is what makes a rejected admission stop the call before it is ever made. A
 * `model-cache-hit` record already carries the call's `providerId`/`modelId` — unlike a bare
 * cache-hit report with no prior admission — so this adapter always admits it too, rather than
 * relying on the ledger's admission-free cache-hit path, keeping every metered call attributable
 * to a provider and model.
 */
async function meteredAppend(
  record: TExecutionJournalRecord,
  inner: { append(record: TExecutionJournalRecord): Promise<void> },
  services: TurnServices,
): Promise<void> {
  if (record.kind === 'model-request') {
    await services.admitModelCall({
      callId: record.callId,
      providerId: record.providerId,
      modelId: record.modelId,
    });
    await inner.append(record);
    return;
  }
  if (record.kind === 'model-cache-hit') {
    await services.admitModelCall({
      callId: record.callId,
      providerId: record.providerId,
      modelId: record.modelId,
    });
    await inner.append(record);
    await services.recordUsage(usageReport(record.callId, 'cache-hit', record.response));
    return;
  }
  await inner.append(record);
  if (record.kind === 'model-response') {
    await services.recordUsage(usageReport(record.callId, 'completed', record.response));
  } else if (record.kind === 'model-failure') {
    await services.recordUsage({
      callId: record.callId,
      outcome: 'failed',
      provenance: 'unknown',
      final: true,
    });
  }
}

/** Wrap a plain journal (used by `robotaParticipant`, which has no continuation) with metering. */
export function meterJournal(inner: IExecutionJournal, services: TurnServices): IExecutionJournal {
  return {
    append: (record) => meteredAppend(record, inner, services),
  };
}

/** Wrap a recoverable journal (used by `sessionParticipant`) with metering; `read` passes through. */
export function meterRecoverableJournal(
  inner: IRecoverableExecutionJournal,
  services: TurnServices,
): IRecoverableExecutionJournal {
  return {
    append: (record) => meteredAppend(record, inner, services),
    read: (executionId) => inner.read(executionId),
  };
}
