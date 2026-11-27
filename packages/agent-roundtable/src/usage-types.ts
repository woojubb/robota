import type { JsonValue } from './json-value';

/**
 * Whether a participant factory or selector can be attributed model calls at all. 'enforced' also
 * declares every call's bound before it is dispatched, which a budget needs to admit the call.
 */
export type ModelCallCapability = 'none' | 'metered' | 'enforced';

/** The most one call can consume: its whole input and the largest output it may produce. */
export interface ModelCallBound {
  inputTokens: number;
  maxOutputTokens: number;
}

/**
 * Identifies one outbound provider call, before its outcome is known. A bound is part of the call's
 * identity when admission is retried, and a strict budget refuses a call that declares none.
 */
export interface ModelCallIntent {
  callId: string;
  providerId: string;
  modelId: string;
  bound?: ModelCallBound;
}

export type UsageOutcome = 'completed' | 'failed' | 'cancelled' | 'cache-hit';

/** How trustworthy the reported counts are; only 'reported' comes straight from the provider. */
export type UsageProvenance = 'reported' | 'partial' | 'estimated' | 'unknown';

/** Non-negative integers; a reporter with fractional provider counts must round them first. */
export interface UsageTokens {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
}

/**
 * What a participant or selector reports back once a call has an outcome. A call that was admitted
 * needs no identity here: its providerId and modelId already came from admission, and any given here
 * are ignored. A cache hit needs no admission, but a cache hit with none must carry providerId and
 * modelId itself, since nothing else fixed them; omitting them is rejected rather than stored empty.
 */
export interface UsageReport {
  callId: string;
  outcome: UsageOutcome;
  provenance: UsageProvenance;
  providerId?: string;
  modelId?: string;
  tokens?: UsageTokens;
  raw?: JsonValue;
  /** False marks a partial report that may still be replaced; true locks it. */
  final: boolean;
}

/** An integer amount in the currency's smallest unit; never summed across currencies. */
export interface Money {
  currency: string;
  minorUnits: string;
}

export type UsagePrincipal = { kind: 'participant' | 'selector'; id: string };

/** What a budget counts: tokens are `input + output` (cache and reasoning are parts of those). */
export interface UsageAmount {
  tokens: number;
  cost: Money | null;
}

/** The amount admission set aside for a call, and whether the call or an estimator supplied it. */
export interface UsageReservation extends UsageAmount {
  provenance: 'declared' | 'estimated';
}

/**
 * A ceiling over a conversation's whole ledger. A 'strict' budget admits only calls that declare their
 * bound; an 'estimated' one lets an estimator supply a bound the call did not declare.
 */
export interface UsageBudget {
  tokens?: number;
  cost?: Money;
  mode?: 'strict' | 'estimated';
}

export interface UsageEstimate {
  bound?: ModelCallBound;
  cost?: Money;
}

/** Synchronous, run once per admission inside the serialized state update, like `PricePolicy.cost`. */
export interface UsageEstimator {
  estimate(call: ModelCallIntent): UsageEstimate;
}

/** What the host settles a call's usage at when its own report never arrived or was not trustworthy. */
export interface UsageReconciliation {
  callId: string;
  tokens: number;
  cost?: Money;
}

interface UsageRecordIdentity extends ModelCallIntent {
  conversationId: string;
  runId: string;
  principal: UsagePrincipal;
  turnId: string | null;
  groupId: string | null;
  attemptId: string;
  /** The revision at which this record last changed. */
  revision: number;
  price: { version: string; cost: Money | null } | null;
  /**
   * Whether admission ever reserved this call. False only for a cache hit reported with no prior
   * admission — a free hit that never drew on any call-limit allowance. Every limit that counts
   * calls excludes a record with this false.
   */
  admitted: boolean;
  /** Set aside by admission under a budget; null with no budget, and for an admission-free cache hit. */
  reservation: UsageReservation | null;
  /** Set only by the host: the amount a call whose usage was never fully reported counts for. */
  reconciled: UsageAmount | null;
}

/**
 * A ledger entry for one model call. 'reserved' means admission succeeded but no report has
 * settled it yet; 'settled' carries the outcome. Records are never removed, so a call that never
 * settles still counts against every call limit it was admitted under. Under a budget a record counts
 * at its reserved bound until a report that fully shows its usage, or a host reconcile, replaces it.
 */
export type UsageRecord =
  | (UsageRecordIdentity & { status: 'reserved' })
  | (UsageRecordIdentity & { status: 'settled' } & Omit<UsageReport, 'callId'>);

/**
 * Bound by the core to one principal (a participant or the selector) and, for a participant, one
 * turn. A participant or selector cannot construct this itself and cannot forge another principal's
 * identity through it.
 */
export interface TurnServices {
  /**
   * Awaited before dispatching the call; idempotent when retried with the same callId and bound. A
   * rejection because a call limit or the budget was reached also stops the run, the same way
   * cancellation does.
   */
  admitModelCall(call: ModelCallIntent): Promise<void>;
  /**
   * Reports a call's outcome. An identical report is a no-op; a report is replaceable until final,
   * and a call the host reconciled accepts no new report.
   * Settles even after the run that admitted the call was cancelled or limited, as long as this
   * process still holds the conversation; only admitting a new call is refused once a run has stopped.
   */
  recordUsage(report: UsageReport): Promise<void>;
}

/** A versioned cost function; changing the version requires explicit migration on reload. */
export interface PricePolicy {
  version: string;
  cost(record: UsageRecord): Money | null;
  /**
   * The most a call can cost given its declared bound, or null when it cannot be priced. Synchronous,
   * and required by a strict cost budget, which sets that amount aside before the call is dispatched.
   */
  bound?(call: ModelCallIntent & { bound: ModelCallBound }): Money | null;
}

export interface UsageSummary {
  totalCalls: number;
  reservedCalls: number;
  settledCalls: number;
  /** Settled calls whose provenance is 'unknown' (never inferred as zero-cost or zero-token). */
  unknownCalls: number;
  tokens: Required<UsageTokens>;
  /** One entry per currency that appeared; amounts are never combined across currencies. */
  cost: Money[];
}

/** Aggregates a ledger slice for display; callers filter records (by run, participant, ...) first. */
export function summarizeUsage(records: readonly UsageRecord[]): UsageSummary {
  const tokens: Required<UsageTokens> = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
  };
  const costByCurrency = new Map<string, bigint>();
  let reservedCalls = 0;
  let settledCalls = 0;
  let unknownCalls = 0;
  for (const record of records) {
    if (record.status === 'reserved') {
      reservedCalls++;
      continue;
    }
    settledCalls++;
    if (record.provenance === 'unknown') unknownCalls++;
    if (record.tokens) {
      for (const key of Object.keys(tokens) as (keyof UsageTokens)[]) {
        const value = record.tokens[key];
        if (typeof value === 'number') tokens[key] += value;
      }
    }
    if (record.price?.cost) {
      const { currency, minorUnits } = record.price.cost;
      costByCurrency.set(currency, (costByCurrency.get(currency) ?? 0n) + BigInt(minorUnits));
    }
  }
  return {
    totalCalls: records.length,
    reservedCalls,
    settledCalls,
    unknownCalls,
    tokens,
    cost: [...costByCurrency].map(([currency, minorUnits]) => ({
      currency,
      minorUnits: minorUnits.toString(),
    })),
  };
}
