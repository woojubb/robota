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

/**
 * Wrap a plain `IExecutionJournal` so every provider call it journals is admitted and reported
 * through `services` — the same metering `robotaParticipant`/`robotaSelector` apply internally,
 * exported so a host can give the same guarantee to a Robota-backed participant or selector it
 * writes itself, without going through either of this package's own wrappers.
 *
 * `services.admitModelCall` is awaited before a `model-request` record reaches `inner`, so a
 * rejected admission stops the call before it is ever dispatched. `model-response`/`model-failure`
 * report `completed`/`failed` usage after the fact; `model-cache-hit` reports a `cache-hit` with no
 * admission, since serving one from cache costs nothing. Every other record kind passes through to
 * `inner` untouched. For a `Session`-backed, checkpoint-resumable journal use
 * `meterRecoverableJournal` from `@robota-sdk/agent-roundtable-robota/session` instead.
 */
export function meterJournal(inner: IExecutionJournal, services: TurnServices): IExecutionJournal {
  return {
    append: (record) => meteredAppend(record, inner, services),
  };
}

/**
 * The `IRecoverableExecutionJournal` counterpart to {@link meterJournal} — same metering, plus a
 * passed-through `read`, for a host's own checkpoint-resumable participant (what `sessionParticipant`
 * uses internally). Exported from `@robota-sdk/agent-roundtable-robota/session`, not the root entry.
 */
export function meterRecoverableJournal(
  inner: IRecoverableExecutionJournal,
  services: TurnServices,
): IRecoverableExecutionJournal {
  return {
    append: (record) => meteredAppend(record, inner, services),
    read: (executionId) => inner.read(executionId),
  };
}
