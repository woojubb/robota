import type { IPersonalApi, ITaskOfferView } from '../api.js';

/** A topic as the agent keeps it: one spelling, so a variant of the same word is the same topic. */
export function topicKey(category: string): string {
  return category.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

/** The source of an offer as the preferences name it: `library`, or the connected service's id. */
export function sourceKey(offer: Pick<ITaskOfferView, 'evidence'>): string | undefined {
  const { evidence } = offer;
  if (evidence === undefined) return undefined;
  return evidence.kind === 'library' ? 'library' : evidence.connectorId;
}

/**
 * Add one topic or source to what the person has muted. The lists are read again just before the
 * change, because a change replaces a list whole and another page may have muted something since this
 * one loaded. Nothing is assumed: the agent's answer, or its refusal, is the outcome.
 */
export async function muteSuggestions(
  api: IPersonalApi,
  kind: 'topic' | 'source',
  value: string,
): Promise<void> {
  const { preferences } = await api.offerPreferences();
  const field = kind === 'topic' ? 'mutedTopics' : 'mutedSources';
  const held = preferences[field];
  if (held.includes(value)) return;
  await api.changeOfferPreferences({ [field]: [...held, value] });
}
