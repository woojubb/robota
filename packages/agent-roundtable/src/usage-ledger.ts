import { RoundtableError } from './errors';
import { canonicalJson } from './json';
import { admitUnderBudget, budgetExhausted, resolveReservation } from './usage-budget';
import {
  USAGE_OUTCOMES,
  USAGE_PROVENANCES,
  validBudgetCost,
  validModelCallBound,
  validUsageCost,
  validUsageTokens,
} from './usage-validation';
import type { ConversationState } from './conversation-state';
import type {
  ModelCallCapability,
  ModelCallIntent,
  PricePolicy,
  ToolEffectIntent,
  TurnServices,
  UsageCallKind,
  UsageEstimator,
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

function sameIdentity(
  record: UsageRecord,
  ctx: UsageContext,
  call: ModelCallIntent,
  kind: UsageCallKind,
): boolean {
  return (
    record.kind === kind &&
    record.conversationId === ctx.conversationId &&
    record.providerId === call.providerId &&
    record.modelId === call.modelId &&
    record.principal.kind === ctx.principal.kind &&
    record.principal.id === ctx.principal.id
  );
}

/**
 * Pure mutator run inside `persistence.update`, so concurrent admissions from parallel members are
 * serialized by the same lock that already orders every other state change. Idempotent per callId and
 * bound: re-admitting a call already reserved or settled is a no-op rather than a second reservation,
 * and a changed bound conflicts. Under a budget the call is admitted only while the bound it declares
 * fits beside everything already spent or reserved. A tool effect (`kind`) is admitted the same way
 * but is not a model call: it skips every model-call limit, though it still counts against a budget.
 */
export function reserveModelCall(
  state: ConversationState,
  revision: number,
  ctx: UsageContext,
  call: ModelCallIntent,
  policies: { pricing?: PricePolicy; estimator?: UsageEstimator } = {},
  kind: UsageCallKind = 'model',
): void {
  if (!text(call.callId) || !text(call.providerId) || !text(call.modelId))
    throw new RoundtableError('invalid-config', 'Model call identity is invalid');
  if (call.bound !== undefined && !validModelCallBound(call.bound))
    throw new RoundtableError(
      'invalid-config',
      'A model call bound needs non-negative integer input and maximum output tokens',
    );
  const usage = state.snapshot.usage;
  const existing = usage.find((record) => record.callId === call.callId);
  if (existing) {
    // A refund is final: admitting the id again would reserve nothing and let the effect run unbudgeted.
    if (existing.status === 'settled' && existing.outcome === 'not-dispatched')
      throw new RoundtableError(
        'conflict',
        'A call refunded as never dispatched cannot be admitted again',
      );
    if (!sameIdentity(existing, ctx, call, kind))
      throw new RoundtableError('conflict', 'Model call id was already used by another call');
    if (canonicalJson(existing.bound ?? null) !== canonicalJson(call.bound ?? null))
      throw new RoundtableError(
        'conflict',
        'Model call id was already admitted with another bound',
      );
    return;
  }
  const limits = state.definition.limits;
  const admittedUsage = usage.filter((record) => record.admitted && record.kind === 'model');
  if (kind === 'model' && limits.maxModelCallsPerRun !== null) {
    const count = admittedUsage.filter((record) => record.runId === ctx.runId).length;
    if (count >= limits.maxModelCallsPerRun)
      throw new RoundtableError('model-call-limit', 'Model-call limit for this run was reached');
  }
  if (kind === 'model' && limits.maxModelCallsPerConversation !== null) {
    if (admittedUsage.length >= limits.maxModelCallsPerConversation)
      throw new RoundtableError(
        'model-call-limit',
        'Model-call limit for this conversation was reached',
      );
  }
  if (
    kind === 'model' &&
    limits.maxModelCallsPerParticipant !== null &&
    ctx.principal.kind === 'participant'
  ) {
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
  const budget = state.definition.budget;
  const reservation =
    budget === null
      ? null
      : resolveReservation(call, kind, budget, policies.pricing, policies.estimator);
  if (budget !== null && reservation !== null) admitUnderBudget(usage, budget, reservation);
  const record: UsageRecord = {
    kind,
    callId: call.callId,
    providerId: call.providerId,
    modelId: call.modelId,
    ...(call.bound === undefined ? {} : { bound: { ...call.bound } }),
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
    reservation,
    reconciled: null,
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
    if (existing.kind === 'tool-effect' && report.outcome === 'cache-hit')
      throw new RoundtableError('conflict', 'A tool effect cannot be reported as a cache hit');
    if (existing.status === 'settled' && sameReport(existing, report)) return;
    if (existing.reconciled)
      throw new RoundtableError('conflict', 'A reconciled call accepts no further usage report');
    if (existing.status === 'settled') {
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
    kind: 'model' as UsageCallKind,
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
    kind: base.kind,
    callId: base.callId,
    providerId: base.providerId,
    modelId: base.modelId,
    ...(existing?.bound === undefined ? {} : { bound: existing.bound }),
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
    // The reservation is kept as admitted: what the record counts is decided from it and the report.
    reservation: existing?.reservation ?? null,
    reconciled: existing?.reconciled ?? null,
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
  const budget = state.definition.budget;
  if (budget?.cost && cost !== null && !validBudgetCost(cost, budget.cost.currency))
    throw new RoundtableError(
      'invalid-config',
      'A cost budget requires a non-negative price in the budget currency',
    );
  settled.price = pricing ? { version: pricing.version, cost } : null;
  if (index === -1) usage.push(settled);
  else usage[index] = settled;
}

function callCountSpent(
  state: ConversationState,
  runId: string,
  principals: readonly UsagePrincipal[],
): boolean {
  const { limits } = state.definition;
  const usage = state.snapshot.usage.filter((record) => record.admitted && record.kind === 'model');
  const needed = principals.length;
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
 * Which limit, if any, leaves these principals no room to start. Work that could not admit its first
 * call is refused before it starts, and a group is refused whole because it commits only whole. A call
 * count limit is reported first; a budget refuses once any of its amounts is fully spent. Principals
 * that make no model calls are never refused.
 */
export function spentLimit(
  state: ConversationState,
  runId: string,
  principals: readonly UsagePrincipal[],
): 'model-calls' | 'budget' | null {
  if (principals.length === 0) return null;
  if (callCountSpent(state, runId, principals)) return 'model-calls';
  const { budget } = state.definition;
  return budget !== null && budgetExhausted(state.snapshot.usage, budget) ? 'budget' : null;
}

/** Whether a declared capability means the caller's calls are admitted and reported. */
export function meters(capability: ModelCallCapability | undefined): boolean {
  return capability === 'metered' || capability === 'enforced';
}

/**
 * Any model-call limit, pricing policy or budget requires every agent factory and the selector to
 * declare a capability, so that a participant nobody metered cannot silently be governed by a limit it
 * never agreed to observe. A budget goes further: only a caller that makes no calls or declares each
 * call's bound before dispatch can be held to it, so a merely metered one is refused.
 */
export function requireModelCallCapabilities(options: {
  participants: readonly ParticipantDefinition[];
  selector: TurnSelector;
  governed: boolean;
  budgeted: boolean;
}): void {
  if (!options.governed) return;
  const missing = (capability: ModelCallCapability | undefined): boolean =>
    capability === undefined;
  const unbounded = (capability: ModelCallCapability | undefined): boolean =>
    options.budgeted && capability !== 'none' && capability !== 'enforced';
  if (missing(options.selector.modelCalls))
    throw new RoundtableError(
      'invalid-config',
      'Model-call limits, pricing or a budget require the selector to declare modelCalls',
    );
  if (unbounded(options.selector.modelCalls))
    throw new RoundtableError(
      'invalid-config',
      'A budget requires the selector to declare modelCalls as none or enforced',
    );
  for (const participant of options.participants) {
    if (participant.kind !== 'agent') continue;
    const { modelCalls } = (participant as AgentParticipant).factory;
    if (missing(modelCalls))
      throw new RoundtableError(
        'invalid-config',
        `Model-call limits, pricing or a budget require every agent factory to declare modelCalls: ${participant.id}`,
      );
    if (unbounded(modelCalls))
      throw new RoundtableError(
        'invalid-config',
        `A budget requires every agent factory to declare modelCalls as none or enforced: ${participant.id}`,
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
  onLimit: (reason: 'model-calls' | 'budget') => void;
  pricing?: PricePolicy;
  estimator?: UsageEstimator;
}): TurnServices {
  const { persistence, emit, signal, ctx, onLimit, pricing, estimator } = options;
  async function admit(call: ModelCallIntent, kind: UsageCallKind): Promise<void> {
    signal.throwIfAborted();
    try {
      await persistence.update((draft, revision) => {
        reserveModelCall(draft, revision, ctx, call, { pricing, estimator }, kind);
      });
    } catch (error) {
      // A reached limit ends the run like a time limit rather than failing the conversation.
      if (error instanceof RoundtableError && error.code === 'model-call-limit')
        onLimit('model-calls');
      if (error instanceof RoundtableError && error.code === 'budget-limit') onLimit('budget');
      throw error;
    }
    const record = persistence.snapshot().snapshot.usage.find((r) => r.callId === call.callId);
    if (record) await emit({ type: 'usage', record }, signal);
  }
  return {
    async admitModelCall(call: ModelCallIntent): Promise<void> {
      await admit(call, 'model');
    },
    async admitToolEffect(effect: ToolEffectIntent): Promise<void> {
      if (
        !text(effect?.callId) ||
        !text(effect.toolName) ||
        !Number.isSafeInteger(effect.tokens) ||
        effect.tokens < 0
      )
        throw new RoundtableError(
          'invalid-config',
          'A tool effect needs a call id, a tool name and a non-negative integer token bound',
        );
      await admit(
        {
          callId: effect.callId,
          providerId: 'tool',
          modelId: effect.toolName,
          bound: { inputTokens: effect.tokens, maxOutputTokens: 0 },
        },
        'tool-effect',
      );
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
