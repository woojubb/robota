import type { JsonValue } from './json-value';

/** Whether a participant factory or selector can be attributed model calls at all. */
export type ModelCallCapability = 'none' | 'metered';

/** Identifies one outbound provider call, before its outcome is known. */
export interface ModelCallIntent {
  callId: string;
  providerId: string;
  modelId: string;
}

export type UsageOutcome = 'completed' | 'failed' | 'cancelled' | 'cache-hit';

/** How trustworthy the reported counts are; only 'reported' comes straight from the provider. */
export type UsageProvenance = 'reported' | 'partial' | 'estimated' | 'unknown';

export interface UsageTokens {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
}

/** What a participant or selector reports back once a call it admitted has an outcome. */
export interface UsageReport {
  callId: string;
  outcome: UsageOutcome;
  provenance: UsageProvenance;
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
}

/**
 * A ledger entry for one model call. 'reserved' means admission succeeded but no report has
 * settled it yet; 'settled' carries the outcome. Reservations are never removed or refunded, so a
 * call that never settles still counts against every limit it was admitted under.
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
  /** Awaited before dispatching the call; idempotent when retried with the same callId. */
  admitModelCall(call: ModelCallIntent): Promise<void>;
  /** Reports a call's outcome. An identical report is a no-op; a report is replaceable until final. */
  recordUsage(report: UsageReport): Promise<void>;
}

/** A versioned cost function; changing the version requires explicit migration on reload. */
export interface PricePolicy {
  version: string;
  cost(record: UsageRecord): Money | null;
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
