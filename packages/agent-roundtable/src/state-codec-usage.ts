import { requireState, record, list, text, integer, unique } from './state-codec-values';

const OUTCOMES = ['completed', 'failed', 'cancelled', 'cache-hit'];
const PROVENANCES = ['reported', 'partial', 'estimated', 'unknown'];
const TOKEN_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];

/** Validate the persisted usage ledger before a registry, pricing policy or participant can act on it. */
export function validateUsageState(
  usage: unknown,
  byId: Map<unknown, Record<string, unknown>>,
  byTurn: Set<string>,
  conversationId: string,
  revision: number,
): void {
  const records = list(usage).map(record);
  unique(records.map((entry) => entry.callId));
  for (const entry of records) {
    requireState(
      text(entry.callId) &&
        text(entry.providerId) &&
        text(entry.modelId) &&
        entry.conversationId === conversationId &&
        text(entry.runId) &&
        text(entry.attemptId) &&
        integer(entry.revision, 1) &&
        entry.revision <= revision,
    );
    const principal = record(entry.principal);
    requireState(
      (principal.kind === 'participant' &&
        text(principal.id) &&
        byId.has(principal.id) &&
        byId.get(principal.id)?.runtime !== null) ||
        (principal.kind === 'selector' && text(principal.id)),
    );
    requireState(entry.turnId === null || text(entry.turnId));
    requireState(entry.groupId === null || text(entry.groupId));
    requireState((entry.turnId === null) === (entry.groupId === null));
    requireState(principal.kind === 'selector' ? entry.turnId === null : true);
    if (principal.kind === 'participant' && entry.turnId !== null) {
      requireState(byTurn.has(`${entry.turnId}:${entry.groupId}:${principal.id}`));
    }
    if (entry.price !== null) {
      const price = record(entry.price);
      requireState(text(price.version));
      if (price.cost !== null) {
        const cost = record(price.cost);
        requireState(
          text(cost.currency) &&
            typeof cost.minorUnits === 'string' &&
            /^-?\d+$/.test(cost.minorUnits),
        );
      }
    }
    requireState(entry.status === 'reserved' || entry.status === 'settled');
    if (entry.status === 'settled') {
      requireState(
        OUTCOMES.includes(String(entry.outcome)) &&
          PROVENANCES.includes(String(entry.provenance)) &&
          typeof entry.final === 'boolean',
      );
      if (entry.tokens !== undefined) {
        const tokens = record(entry.tokens);
        requireState(Object.keys(tokens).every((key) => TOKEN_KEYS.includes(key)));
        for (const key of TOKEN_KEYS) {
          if (Object.hasOwn(tokens, key)) requireState(integer(tokens[key]));
        }
      }
    } else {
      requireState(
        !Object.hasOwn(entry, 'outcome') &&
          !Object.hasOwn(entry, 'provenance') &&
          !Object.hasOwn(entry, 'final') &&
          !Object.hasOwn(entry, 'tokens') &&
          !Object.hasOwn(entry, 'raw'),
      );
    }
  }
}
