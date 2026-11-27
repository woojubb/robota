import { RoundtableError } from './errors';
import { settleUsage, type UsageContext } from './usage-ledger';
import type { ConversationState } from './conversation-state';
import type { CallSettlement, PricePolicy, UsageRecord } from './usage-types';

function refuse(code: 'invalid-config' | 'conflict' | 'call-settled', message: string): never {
  throw new RoundtableError(code, message);
}

/**
 * Pure mutator run inside `persistence.update`. Settles one reserved call from a recovery answer, and
 * only for the principal and attempt the answer was given for. A call is settled once: a call that is
 * unknown, not this principal's, from another attempt, reconciled by the host, or no longer reserved
 * is refused, and a second settlement of a settled call is the typed `call-settled` error rather than
 * a second application. 'not-dispatched' stores a final zero-usage record, so exactly what admission
 * set aside is released while the call still counts against call limits; 'settled' goes through the
 * ordinary settle path with the journal's final report; 'uncertain' stores a final report of unknown
 * provenance, which keeps the bound counted until the host reconciles it and refuses any later report.
 */
export function applyCallSettlement(
  state: ConversationState,
  revision: number,
  ctx: UsageContext,
  settlement: CallSettlement,
  pricing?: PricePolicy,
): void {
  if (typeof settlement?.callId !== 'string' || settlement.callId.length === 0)
    refuse('invalid-config', 'A call settlement requires a call id');
  if (settlement.kind === 'settled') {
    if (settlement.report?.callId !== settlement.callId)
      refuse('invalid-config', 'A settled answer needs a report for the same call');
    if (settlement.report.final !== true)
      refuse('invalid-config', 'A recovered report must be final');
  } else if (settlement.kind !== 'not-dispatched' && settlement.kind !== 'uncertain') {
    refuse('invalid-config', 'A call settlement is not-dispatched, settled or uncertain');
  }
  const usage = state.snapshot.usage;
  const index = usage.findIndex((record) => record.callId === settlement.callId);
  const existing = usage[index];
  if (!existing) refuse('conflict', 'Settlement names a call that is not in the ledger');
  if (
    existing.conversationId !== ctx.conversationId ||
    existing.principal.kind !== ctx.principal.kind ||
    existing.principal.id !== ctx.principal.id ||
    existing.attemptId !== ctx.attemptId
  )
    refuse('conflict', 'Settlement does not belong to this principal and attempt');
  if (existing.status === 'settled') refuse('call-settled', 'This call was already settled');
  if (existing.reconciled) refuse('conflict', 'A call the host reconciled accepts no settlement');
  if (settlement.kind === 'settled') {
    settleUsage(state, revision, ctx, settlement.report, pricing);
    return;
  }
  const settled: UsageRecord =
    settlement.kind === 'not-dispatched'
      ? {
          ...existing,
          status: 'settled',
          revision,
          // Never priced: a refunded call must not be charged by a policy that prices its bound.
          price: pricing ? { version: pricing.version, cost: null } : null,
          outcome: 'not-dispatched',
          provenance: 'reported',
          final: true,
        }
      : {
          ...existing,
          status: 'settled',
          revision,
          outcome: 'failed',
          provenance: 'unknown',
          final: true,
        };
  usage[index] = settled;
}
