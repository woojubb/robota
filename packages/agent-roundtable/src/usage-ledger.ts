import { RoundtableError } from './errors';
import { canonicalJson } from './json';
import {
  USAGE_OUTCOMES,
  USAGE_PROVENANCES,
  validUsageCost,
  validUsageTokens,
} from './usage-validation';
import type { ConversationState } from './conversation-state';
import type {
  ModelCallCapability,
  ModelCallIntent,
  PricePolicy,
  TurnServices,
  UsagePrincipal,
  UsageRecord,
  UsageReport,
} from './usage-types';
import type { ConversationPersistence } from './conversation-persistence';
import type {
  AgentParticipant,
  ParticipantDefinition,
  RoundtableEvent,
  TurnSelector,
} from './types';

export interface UsageContext {
  conversationId: string;
  runId: string;
  principal: UsagePrincipal;
  turnId: string | null;
  groupId: string | null;
  attemptId: string;
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function sameIdentity(record: UsageRecord, ctx: UsageContext, call: ModelCallIntent): boolean {
  return (
    record.conversationId === ctx.conversationId &&
    record.providerId === call.providerId &&
    record.modelId === call.modelId &&
    record.principal.kind === ctx.principal.kind &&
    record.principal.id === ctx.principal.id
  );
}

/**
 * Pure mutator run inside `persistence.update`, so concurrent admissions from parallel members are
 * serialized by the same lock that already orders every other state change. Idempotent per callId:
 * re-admitting a call already reserved or settled is a no-op rather than a second reservation.
 */
export function reserveModelCall(
  state: ConversationState,
  revision: number,
  ctx: UsageContext,
  call: ModelCallIntent,
): void {
  if (!text(call.callId) || !text(call.providerId) || !text(call.modelId))
    throw new RoundtableError('invalid-config', 'Model call identity is invalid');
  const usage = state.snapshot.usage;
  const existing = usage.find((record) => record.callId === call.callId);
  if (existing) {
    if (!sameIdentity(existing, ctx, call))
      throw new RoundtableError('conflict', 'Model call id was already used by another call');
    return;
  }
  const limits = state.definition.limits;
  const admittedUsage = usage.filter((record) => record.admitted);
  if (limits.maxModelCallsPerRun !== null) {
    const count = admittedUsage.filter((record) => record.runId === ctx.runId).length;
    if (count >= limits.maxModelCallsPerRun)
      throw new RoundtableError('model-call-limit', 'Model-call limit for this run was reached');
  }
  if (limits.maxModelCallsPerConversation !== null) {
    if (admittedUsage.length >= limits.maxModelCallsPerConversation)
      throw new RoundtableError(
        'model-call-limit',
        'Model-call limit for this conversation was reached',
      );
  }
  if (limits.maxModelCallsPerParticipant !== null && ctx.principal.kind === 'participant') {
    const count = admittedUsage.filter(
      (record) =>
        record.principal.kind === 'participant' && record.principal.id === ctx.principal.id,
    ).length;
    if (count >= limits.maxModelCallsPerParticipant)
      throw new RoundtableError(
        'model-call-limit',
        'Model-call limit for this participant was reached',
      );
  }
  const record: UsageRecord = {
    callId: call.callId,
    providerId: call.providerId,
    modelId: call.modelId,
    conversationId: ctx.conversationId,
    runId: ctx.runId,
    principal: ctx.principal,
    turnId: ctx.turnId,
    groupId: ctx.groupId,
    attemptId: ctx.attemptId,
    status: 'reserved',
    revision,
    price: null,
    admitted: true,
  };
  usage.push(record);
}

/**
 * Rejects a report the load codec would later reject, so nothing unloadable is ever stored. Kept in
 * sync with `validateUsageState` (`state-codec-usage.ts`) through the shared `usage-validation` checks.
 */
function validReport(report: UsageReport): void {
  if (!text(report.callId))
    throw new RoundtableError('invalid-config', 'Usage report call id is required');
  if (!(USAGE_OUTCOMES as readonly string[]).includes(report.outcome))
    throw new RoundtableError('invalid-config', 'Usage report outcome is invalid');
  if (!(USAGE_PROVENANCES as readonly string[]).includes(report.provenance))
    throw new RoundtableError('invalid-config', 'Usage report provenance is invalid');
  if (typeof report.final !== 'boolean')
    throw new RoundtableError('invalid-config', 'Usage report finality is invalid');
  if (report.tokens !== undefined && !validUsageTokens(report.tokens))
    throw new RoundtableError(
      'invalid-config',
      'Usage report tokens must be non-negative integers under recognized keys',
    );
  canonicalJson({ tokens: report.tokens ?? null, raw: report.raw ?? null });
}

function sameReport(a: UsageRecord & { status: 'settled' }, b: UsageReport): boolean {
  return (
    a.outcome === b.outcome &&
    a.provenance === b.provenance &&
    a.final === b.final &&
    canonicalJson(a.tokens ?? null) === canonicalJson(b.tokens ?? null) &&
    canonicalJson(a.raw ?? null) === canonicalJson(b.raw ?? null)
  );
}

/**
 * Pure mutator run inside `persistence.update`. A report with no prior reservation is rejected
 * unless it reports a cache hit, which never needed admission; that case must carry its own
 * providerId and modelId in the report, since no admission fixed them, and is rejected without them
 * rather than stored with an empty identity. An identical report replayed against an already-settled
 * call is a no-op; once a settled report is final, any differing report conflicts. A pricing policy
 * that returns a cost the load codec would reject is rejected here too, before it is ever stored.
 */
export function settleUsage(
  state: ConversationState,
  revision: number,
  ctx: UsageContext,
  report: UsageReport,
  pricing?: PricePolicy,
): void {
  validReport(report);
  const usage = state.snapshot.usage;
  const index = usage.findIndex((record) => record.callId === report.callId);
  const existing = index === -1 ? undefined : usage[index];
  if (existing) {
    if (
      existing.conversationId !== ctx.conversationId ||
      existing.principal.kind !== ctx.principal.kind ||
      existing.principal.id !== ctx.principal.id
    )
      throw new RoundtableError('conflict', 'Usage report does not belong to this principal');
    if (existing.status === 'settled') {
      if (sameReport(existing, report)) return;
      if (existing.final)
        throw new RoundtableError('conflict', 'A final usage report cannot be replaced');
      if (!existing.admitted && report.outcome !== 'cache-hit')
        throw new RoundtableError('conflict', 'Usage report requires a prior admission');
    }
  } else if (report.outcome !== 'cache-hit') {
    throw new RoundtableError('conflict', 'Usage report requires a prior admission');
  } else if (!text(report.providerId) || !text(report.modelId)) {
    throw new RoundtableError(
      'invalid-config',
      'A cache-hit report with no prior admission must include providerId and modelId',
    );
  }
  const base = existing ?? {
    callId: report.callId,
    providerId: report.providerId as string,
    modelId: report.modelId as string,
    conversationId: ctx.conversationId,
    runId: ctx.runId,
    principal: ctx.principal,
    turnId: ctx.turnId,
    groupId: ctx.groupId,
    attemptId: ctx.attemptId,
    price: null,
    // Reaching here with no `existing` record means no admission ever reserved this callId.
    admitted: false,
  };
  const settled: UsageRecord = {
    callId: base.callId,
    providerId: base.providerId,
    modelId: base.modelId,
    conversationId: base.conversationId,
    runId: base.runId,
    principal: base.principal,
    turnId: base.turnId,
    groupId: base.groupId,
    attemptId: base.attemptId,
    status: 'settled',
    revision,
    price: null,
    admitted: base.admitted,
    outcome: report.outcome,
    provenance: report.provenance,
    final: report.final,
    ...(report.tokens !== undefined ? { tokens: report.tokens } : {}),
    ...(report.raw !== undefined ? { raw: report.raw } : {}),
  };
  const cost = pricing ? pricing.cost(settled) : null;
  if (cost !== null && !validUsageCost(cost))
    throw new RoundtableError(
      'invalid-config',
      'Pricing policy returned a cost whose amount is not an integer string',
    );
  settled.price = pricing ? { version: pricing.version, cost } : null;
  if (index === -1) usage.push(settled);
  else usage[index] = settled;
}

/**
 * Whether a limit leaves these principals fewer calls than one each. Work that could not admit its
 * first call is refused before it starts, and a group is refused whole because it commits only whole.
 */
export function modelCallsSpent(
  state: ConversationState,
  runId: string,
  principals: readonly UsagePrincipal[],
): boolean {
  const { limits } = state.definition;
  const usage = state.snapshot.usage.filter((record) => record.admitted);
  const needed = principals.length;
  if (needed === 0) return false;
  const runUsed = usage.filter((record) => record.runId === runId).length;
  if (limits.maxModelCallsPerRun !== null && limits.maxModelCallsPerRun - runUsed < needed)
    return true;
  if (
    limits.maxModelCallsPerConversation !== null &&
    limits.maxModelCallsPerConversation - usage.length < needed
  )
    return true;
  const perParticipant = limits.maxModelCallsPerParticipant;
  return (
    perParticipant !== null &&
    principals.some(
      (principal) =>
        principal.kind === 'participant' &&
        usage.filter(
          (record) =>
            record.principal.kind === 'participant' && record.principal.id === principal.id,
        ).length >= perParticipant,
    )
  );
}

/**
 * Any model-call limit or pricing policy requires every agent factory and the selector to declare a
 * capability, so that a participant nobody metered cannot silently be governed by a limit it never
 * agreed to observe.
 */
export function requireModelCallCapabilities(options: {
  participants: readonly ParticipantDefinition[];
  selector: TurnSelector;
  governed: boolean;
}): void {
  if (!options.governed) return;
  const missing = (capability: ModelCallCapability | undefined): boolean =>
    capability === undefined;
  if (missing(options.selector.modelCalls))
    throw new RoundtableError(
      'invalid-config',
      'Model-call limits or pricing require the selector to declare modelCalls',
    );
  for (const participant of options.participants) {
    if (participant.kind !== 'agent') continue;
    if (missing((participant as AgentParticipant).factory.modelCalls))
      throw new RoundtableError(
        'invalid-config',
        `Model-call limits or pricing require every agent factory to declare modelCalls: ${participant.id}`,
      );
  }
}

/**
 * Binds admission and reporting to one principal (a participant's turn, or the selector's current
 * selection attempt); neither side can be forged by the participant or selector code that receives it.
 * Admission is refused once `signal` (the run) has stopped, so no new call is admitted after
 * cancellation or a limit. Reporting is not: a response that settles after the run stopped still
 * gates on `persistence`'s own store ownership, not on `signal`, so a call already admitted keeps its
 * usage even if the run that admitted it was cancelled, timed out or hit a limit before it settled.
 */
export function createTurnServices(options: {
  persistence: ConversationPersistence;
  emit: (event: RoundtableEvent, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  ctx: UsageContext;
  /** Stops the run before the rejection reaches the caller, so the attempt is treated as stopped. */
  onLimit: () => void;
  pricing?: PricePolicy;
}): TurnServices {
  const { persistence, emit, signal, ctx, onLimit, pricing } = options;
  return {
    async admitModelCall(call: ModelCallIntent): Promise<void> {
      signal.throwIfAborted();
      try {
        await persistence.update((draft, revision) => {
          reserveModelCall(draft, revision, ctx, call);
        });
      } catch (error) {
        // A reached limit ends the run like a time limit rather than failing the conversation.
        if (error instanceof RoundtableError && error.code === 'model-call-limit') onLimit();
        throw error;
      }
      const record = persistence.snapshot().snapshot.usage.find((r) => r.callId === call.callId);
      if (record) await emit({ type: 'usage', record }, signal);
    },
    async recordUsage(report: UsageReport): Promise<void> {
      // Not gated on `signal`: a response that settles after the run stopped still belongs in the
      // ledger. `persistence.update` still refuses this once the store owner it was bound to is gone.
      const before = persistence
        .snapshot()
        .snapshot.usage.find((record) => record.callId === report.callId);
      if (before?.status === 'settled' && sameReport(before, report)) return;
      await persistence.update((draft, revision) => {
        settleUsage(draft, revision, ctx, report, pricing);
      });
      const record = persistence.snapshot().snapshot.usage.find((r) => r.callId === report.callId);
      // A stopped run's own signal is aborted by then; skip the courtesy event rather than let it throw.
      if (record && !signal.aborted) await emit({ type: 'usage', record }, signal);
    },
  };
}
