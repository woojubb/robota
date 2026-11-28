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
import { requestBound } from './call-bound';
import {
  isDeclaredTool,
  normalizeEnforcement,
  type CallEnforcement,
  type RuntimeEnforcement,
} from './enforcement';
import { RuntimeParticipantError } from './errors';

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
export function usageReport(
  callId: string,
  outcome: UsageReport['outcome'],
  response: TUniversalMessage,
  identity?: { providerId: string; modelId: string },
  attempts = 1,
): UsageReport {
  const verified = verifiedProviderCallUsage(response);
  // One admission covers every attempt inside the call, and the usage a provider reports may
  // describe only the last of them, so a multi-attempt call keeps its bound until the host reconciles.
  const provenance: UsageProvenance =
    verified.provenance === 'complete'
      ? attempts > 1
        ? 'partial'
        : 'reported'
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
 * The prefix of every paid tool effect's ledger call id. It keeps those ids apart from the model
 * call ids the journal derives, so an enforced runtime can refuse a model call that tries to take one.
 */
export const TOOL_EFFECT_CALL_PREFIX = 'tool-effect:';

export type ToolEffectStart = Extract<TExecutionJournalRecord, { kind: 'tool-effect-start' }>;

/**
 * Where a paid effect's ledger call id comes from. The journal's action id is not enough: a resumed
 * attempt reuses it, and a call recovery refunded as never dispatched may not be admitted again under
 * its old id. So each admission takes a fresh id, which the source records before the caller admits
 * it, and recovery can then map every reserved call back to the action it was for.
 */
export interface EffectCallIds {
  /** The same record always gets the same id, so a repeated append stays one admission. */
  claim(record: ToolEffectStart): Promise<string>;
}

/** Ids that live as long as the wrapper using them, for a journal that keeps no recovery log. */
export function freshEffectCallIds(): EffectCallIds {
  const claimed = new Map<string, string>();
  return {
    async claim(record) {
      let callId = claimed.get(record.actionId);
      if (!callId) {
        callId = `${TOOL_EFFECT_CALL_PREFIX}${crypto.randomUUID()}`;
        claimed.set(record.actionId, callId);
      }
      return callId;
    },
  };
}

/** The paid effects a journal has admitted and not yet settled, by action id. */
type StartedEffects = Map<string, { callId: string; tokens: number }>;

/**
 * What the adapter knows when an admitted effect reaches its result. A money-only effect consumed no
 * tokens, and its report never varies with the tool's own verdict, so a repeat of the same result
 * repeats the report exactly (a different report after a final one would conflict). A model-backed
 * effect's consumption is unknown to the adapter: it stays non-final, so the bound is kept until the
 * host reconciles it and a repeated result can replace it.
 */
export function effectReport(callId: string, tokens: number, succeeded: boolean): UsageReport {
  if (tokens === 0)
    return {
      callId,
      outcome: 'completed',
      provenance: 'reported',
      tokens: { input: 0, output: 0 },
      final: true,
    };
  return {
    callId,
    outcome: succeeded ? 'completed' : 'failed',
    provenance: 'unknown',
    final: false,
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
  enforcement: CallEnforcement | undefined,
  started: StartedEffects,
  effectCalls: EffectCallIds,
): Promise<void> {
  if (enforcement && record.kind === 'managed-frame')
    throw new RuntimeParticipantError(
      'unbounded-call',
      'An enforced runtime cannot take a managed frame: its calls are not bounded by a request',
    );
  if (enforcement && record.kind === 'tool-effect-start') {
    if (!isDeclaredTool(enforcement, record.toolName))
      throw new RuntimeParticipantError(
        'unbounded-call',
        `An enforced runtime must declare every tool free or paid: ${record.toolName}`,
      );
    const tokens = enforcement.paidTools.get(record.toolName);
    if (tokens !== undefined) {
      // Admitted before the start record reaches the inner journal, so a refusal means the effect
      // never starts. A denied approval writes no start record and so is never charged.
      const callId = await effectCalls.claim(record);
      await services.admitToolEffect({ callId, toolName: record.toolName, tokens });
      started.set(record.actionId, { callId, tokens });
    }
    await inner.append(record);
    return;
  }
  if (record.kind === 'model-request') {
    if (enforcement && record.callId.startsWith(TOOL_EFFECT_CALL_PREFIX))
      throw new RuntimeParticipantError(
        'unbounded-call',
        'An enforced runtime reserves the tool-effect call id prefix for paid tool effects',
      );
    // The bound is taken before the inner journal or admission, so a request whose bound cannot be
    // established is refused before anything is recorded or sent.
    const bound = enforcement ? requestBound(record, enforcement) : undefined;
    await services.admitModelCall({
      callId: record.callId,
      providerId: record.providerId,
      modelId: record.modelId,
      ...(bound ? { bound } : {}),
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
  if (record.kind === 'tool-result') {
    const effect = started.get(record.actionId);
    if (effect)
      await services.recordUsage(
        effectReport(effect.callId, effect.tokens, record.result.success === true),
      );
  } else if (record.kind === 'model-response') {
    await services.recordUsage(
      usageReport(
        record.callId,
        'completed',
        record.response,
        undefined,
        enforcement?.providerAttempts,
      ),
    );
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
 * through `services` — the same metering `runtimeParticipant`/`runtimeSelector` apply internally,
 * exported so a host can give the same guarantee to a ConversationAgent-backed participant or selector it
 * writes itself, without going through either of this package's own wrappers.
 *
 * `services.admitModelCall` is awaited before a `model-request` record reaches `inner`, so a
 * rejected admission stops the call before it is ever dispatched. `model-response`/`model-failure`
 * report `completed`/`failed` usage after the fact; `model-cache-hit` reports a `cache-hit` with no
 * admission, since serving one from cache costs nothing. Every other record kind passes through to
 * `inner` untouched. For a `Session`-backed, checkpoint-resumable journal use
 * `meterRecoverableJournal` from `@robota-sdk/agent-roundtable-robota/session` instead.
 *
 * With `enforcement`, every `model-request` is admitted with a bound taken from the request itself
 * and a request whose bound cannot be established is refused (`unbounded-call`) before anything
 * is recorded; see `RuntimeEnforcement`. A declared paid tool's `tool-effect-start` is admitted as a
 * tool effect before it reaches `inner` and settled at its `tool-result`.
 */
export function meterJournal(
  inner: IExecutionJournal,
  services: TurnServices,
  enforcement?: RuntimeEnforcement,
): IExecutionJournal {
  const declared = enforcement && normalizeEnforcement(enforcement);
  const started: StartedEffects = new Map();
  const effectCalls = freshEffectCallIds();
  return {
    append: (record) => meteredAppend(record, inner, services, declared, started, effectCalls),
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
  enforcement?: RuntimeEnforcement,
  effectCalls: EffectCallIds = freshEffectCallIds(),
): IRecoverableExecutionJournal {
  const declared = enforcement && normalizeEnforcement(enforcement);
  const started: StartedEffects = new Map();
  return {
    append: (record) => meteredAppend(record, inner, services, declared, started, effectCalls),
    read: (executionId) => inner.read(executionId),
  };
}
