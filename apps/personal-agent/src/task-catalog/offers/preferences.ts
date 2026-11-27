/**
 * What the person chose about the offers made to them: whether they are made at all, whether one is also
 * pushed or only gathered into the daily digest, and which topics and sources they want or have muted.
 * The words are the person's own: only their request changes them, no tool the agent can call and no text
 * it reads reaches them, and a change is refused whole when any part of it is not valid.
 *
 * A topic is the category of the task an offer is for, a source is the connected service an offer was read
 * from (or the library). A file that cannot be read as these words is read as "off", so an opt-out is never
 * undone by damage; what was written before this existed is not a file at all, which reads as the defaults.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  TaskCatalogRefusedError,
  asRecord,
  listOf,
  normalizedReference,
  oneOf,
  rejectUnknownKeys,
  shaped,
  singleLine,
} from '../fields.js';
import { writeAtomically } from '../json-records.js';

import type { IOffer } from '../types.js';

export const OFFER_DELIVERY_MODES = ['feed', 'notify', 'digest'] as const;
export type TOfferDeliveryMode = (typeof OFFER_DELIVERY_MODES)[number];

export const OFFER_PREFERENCE_LIMITS = { entries: 50, topic: 40 } as const;
const SOURCE = /^(?:library|connector-[a-z0-9-]{1,60})$/u;
const KEYS = ['enabled', 'delivery', 'topics', 'mutedTopics', 'mutedSources'];

export interface IOfferPreferences {
  /** Whether offers are made, shown and started at all. */
  readonly enabled: boolean;
  /** Feed only, a push under the shared limits, or the daily digest only. */
  readonly delivery: TOfferDeliveryMode;
  /** When not empty, only offers for tasks of these categories (lower case, one spelling). */
  readonly topics: readonly string[];
  readonly mutedTopics: readonly string[];
  /** Connected services (by connector id) or `library`. */
  readonly mutedSources: readonly string[];
}

export const DEFAULT_OFFER_PREFERENCES: IOfferPreferences = {
  enabled: true,
  delivery: 'feed',
  topics: [],
  mutedTopics: [],
  mutedSources: [],
};

export interface IOfferPreferencesRead {
  readonly preferences: IOfferPreferences;
  /** Set when the saved words could not be read; the preferences then read as off. */
  readonly issue?: string;
}

export interface IOfferPreferenceStore {
  read(): IOfferPreferencesRead;
  write(preferences: IOfferPreferences): void;
}

const topicList = (value: unknown, field: string): string[] => {
  const kept = listOf(value, field, 0, OFFER_PREFERENCE_LIMITS.entries).map((entry) =>
    normalizedReference(singleLine(entry, field, OFFER_PREFERENCE_LIMITS.topic)),
  );
  return [...new Set(kept)];
};

const sourceList = (value: unknown, field: string): string[] => [
  ...new Set(
    listOf(value, field, 0, OFFER_PREFERENCE_LIMITS.entries).map((entry) =>
      shaped(entry, field, SOURCE, 80),
    ),
  ),
];

/** The preferences with the named parts changed; refused whole when any part is not valid. */
export function changePreferences(current: IOfferPreferences, body: unknown): IOfferPreferences {
  const change = asRecord(body, 'The preferences');
  rejectUnknownKeys(change, KEYS, 'The preferences');
  const enabled = change['enabled'];
  if (enabled !== undefined && typeof enabled !== 'boolean')
    throw new TaskCatalogRefusedError('enabled must be true or false');
  return {
    enabled: enabled ?? current.enabled,
    delivery:
      change['delivery'] === undefined
        ? current.delivery
        : oneOf(change['delivery'], 'delivery', OFFER_DELIVERY_MODES),
    topics: change['topics'] === undefined ? current.topics : topicList(change['topics'], 'topics'),
    mutedTopics:
      change['mutedTopics'] === undefined
        ? current.mutedTopics
        : topicList(change['mutedTopics'], 'mutedTopics'),
    mutedSources:
      change['mutedSources'] === undefined
        ? current.mutedSources
        : sourceList(change['mutedSources'], 'mutedSources'),
  };
}

/** Why the preferences keep an offer from being made, shown or started, or nothing when they allow it. */
export function whyHeldBack(
  preferences: IOfferPreferences,
  offer: { readonly category: string | undefined; readonly source: string | undefined },
): string | undefined {
  if (!preferences.enabled) return 'Suggestions are turned off.';
  const topic = offer.category === undefined ? undefined : normalizedReference(offer.category);
  if (topic !== undefined && preferences.mutedTopics.includes(topic)) return 'This topic is muted.';
  if (offer.source !== undefined && preferences.mutedSources.includes(offer.source))
    return 'This source is muted.';
  if (preferences.topics.length > 0 && (topic === undefined || !preferences.topics.includes(topic)))
    return 'This topic is not one that was asked for.';
  return undefined;
}

/** The source of an offer as the preferences name it: the service it was read from, or the library. */
export function sourceOf(offer: Pick<IOffer, 'evidence'>): string | undefined {
  const { evidence } = offer;
  if (evidence === undefined) return undefined;
  return evidence.kind === 'library' ? 'library' : evidence.connectorId;
}

export function createMemoryOfferPreferences(
  initial: IOfferPreferences = DEFAULT_OFFER_PREFERENCES,
): IOfferPreferenceStore {
  let held = initial;
  return {
    read: () => ({ preferences: held }),
    write: (value) => {
      held = value;
    },
  };
}

/** `offer-preferences.json` in the owner-only task-catalog directory, rewritten whole through a rename. */
export function createFileOfferPreferences(directory: string): IOfferPreferenceStore {
  const path = join(directory, 'offer-preferences.json');
  return {
    read: () => {
      if (!existsSync(path)) return { preferences: DEFAULT_OFFER_PREFERENCES };
      try {
        const stored = JSON.parse(readFileSync(path, 'utf8')) as unknown;
        return { preferences: changePreferences(DEFAULT_OFFER_PREFERENCES, stored) };
      } catch {
        // allow-fallback: words that cannot be read are read as off, so an opt-out survives damage; the issue says so.
        return {
          preferences: { ...DEFAULT_OFFER_PREFERENCES, enabled: false },
          issue: 'Saved suggestion settings could not be read, so suggestions are off.',
        };
      }
    },
    write: (value) => {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeAtomically(path, value);
    },
  };
}
