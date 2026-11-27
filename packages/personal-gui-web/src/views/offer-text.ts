import type { ITaskOfferView } from '../api.js';

const ORIGIN = {
  'built-in': 'Built in',
  owner: 'Added by you',
  agent: 'Suggested by your agent',
} as const;

/** The task an offer is for; an offer whose task has left the catalog has no title to show. */
export function offerTitle(offer: ITaskOfferView): string {
  return offer.definitionTitle ?? 'A task that is no longer in the catalog';
}

/**
 * Who made an offer and where its reason was read: the kind of source and the title the service was
 * added under. Nothing a mail or page said is part of this line.
 */
export function offerSource(offer: ITaskOfferView): string {
  const { evidence } = offer;
  if (evidence === undefined) return ORIGIN[offer.source];
  const where =
    evidence.kind === 'connector'
      ? `Connected service: ${evidence.connectorTitle ?? 'a service you connected'}`
      : 'Your library';
  return `${ORIGIN[offer.source]} · ${where}`;
}

/** The service an offer was read from, by the name the person gave it, or their library. */
export function offerSourceName(offer: ITaskOfferView): string {
  const { evidence } = offer;
  if (evidence === undefined) return ORIGIN[offer.source];
  return evidence.kind === 'connector'
    ? (evidence.connectorTitle ?? 'a service you connected')
    : 'your library';
}

/** Newest first: the one the agent noticed last comes first. */
export function newestFirst(offers: readonly ITaskOfferView[]): readonly ITaskOfferView[] {
  return [...offers].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
