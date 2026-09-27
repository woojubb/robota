import { collectAssistantUsageMetadata, verifiedProviderCallUsage } from '@robota-sdk/agent-core';
import type {
  IExecutionJournal,
  IRecoverableExecutionJournal,
  TExecutionJournalRecord,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import type {
  TurnServices,
  UsageProvenance,
  UsageReport,
  UsageTokens,
} from '@robota-sdk/agent-roundtable';

/** The ledger only accepts non-negative integers; a fractional or non-finite count is dropped. */
function roundedTokenCount(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

function usageTokens(
  usage: ReturnType<typeof collectAssistantUsageMetadata>,
): UsageTokens | undefined {
  if (!usage) return undefined;
  const tokens: UsageTokens = {};
  const input = roundedTokenCount(usage.inputTokens);
  const output = roundedTokenCount(usage.outputTokens);
  const cacheRead = roundedTokenCount(usage.cacheReadTokens);
  if (input !== undefined) tokens.input = input;
  if (output !== undefined) tokens.output = output;
  if (cacheRead !== undefined) tokens.cacheRead = cacheRead;
  return Object.keys(tokens).length > 0 ? tokens : undefined;
}

/**
 * `identity`, when given, is this call's own `providerId`/`modelId` — required by the ledger for a
 * cache hit reported with no prior admission (nothing else fixed its identity), ignored otherwise.
 * Tokens are rounded to the integers the ledger requires and omitted entirely for `'unknown'`
 * provenance: an unverified count attached to an unverified report reads as more trustworthy than
 * it is.
 */
function usageReport(
  callId: string,
  outcome: UsageReport['outcome'],
  response: TUniversalMessage,
  identity?: { providerId: string; modelId: string },
): UsageReport {
  const verified = verifiedProviderCallUsage(response);
  const provenance: UsageProvenance =
    verified.provenance === 'complete'
      ? 'reported'
      : verified.provenance === 'partial'
        ? 'partial'
        : 'unknown';
  const tokens =
    provenance === 'unknown' ? undefined : usageTokens(collectAssistantUsageMetadata(response));
  return {
    callId,
    outcome,
    provenance,
    ...(identity ?? {}),
    ...(tokens ? { tokens } : {}),
    final: true,
  };
}

/**
 * The metering behaviour shared by `meterJournal` and `meterRecoverableJournal`.
 *
 * `callJournaledProvider` (agent-core) writes a `model-request`/`model-cache-hit` record and
 * awaits it before every provider dispatch, so admitting inside `append`, before it reaches the
 * inner journal, is what makes a rejected admission stop the call before it is ever made. A cache
 * hit costs nothing to serve, so it never spends a call-limit allowance it did not need: it is
 * reported straight through the ledger's admission-free cache-hit path instead, carrying this
 * call's own `providerId`/`modelId` — the identity the ledger requires in exactly that case, since
 * no admission fixed it here.
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
    await inner.append(record);
    await services.recordUsage(
      usageReport(record.callId, 'cache-hit', record.response, {
        providerId: record.providerId,
        modelId: record.modelId,
      }),
    );
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
