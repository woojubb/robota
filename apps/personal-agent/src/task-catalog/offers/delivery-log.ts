/**
 * What became of each new offer as far as telling the person goes: pushed, held for the daily digest, or
 * left in the Feed, and why. It is the host's own decision and is kept apart from the person's reactions
 * (shown, opened, started, dismissed), so how often something was held back never reads as how the person
 * met it. One record per offer, written once: an offer already in the log is never delivered again, whatever
 * restarts in between. Owner-only file, rewritten whole through a rename; the newest few hundred are kept.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { writeAtomically } from '../json-records.js';

import type { TDelivery } from '@robota-sdk/agent-product/personal';

export const DELIVERY_REASONS = [
  'pushed',
  'held-for-digest',
  'chosen',
  'not-ready',
  'not-pushed',
  'failed',
] as const;
export type TDeliveryReason = (typeof DELIVERY_REASONS)[number];

export interface IOfferDeliveryRecord {
  readonly offerId: string;
  readonly decision: TDelivery;
  readonly reason: TDeliveryReason;
  readonly at: string;
}

export interface IOfferDeliveryLog {
  find(offerId: string): IOfferDeliveryRecord | undefined;
  /** Keeps the first record of an offer; a second is ignored. */
  record(entry: IOfferDeliveryRecord): void;
}

export const DELIVERY_LOG_MAX = 500;

const DECISIONS: readonly string[] = ['notify', 'digest', 'feed'];

const recordOf = (raw: unknown): IOfferDeliveryRecord | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { offerId, decision, reason, at } = raw as Record<string, unknown>;
  if (
    typeof offerId !== 'string' ||
    typeof decision !== 'string' ||
    !DECISIONS.includes(decision) ||
    typeof reason !== 'string' ||
    !(DELIVERY_REASONS as readonly string[]).includes(reason) ||
    typeof at !== 'string'
  )
    return undefined;
  return { offerId, decision: decision as TDelivery, reason: reason as TDeliveryReason, at };
};

export function createMemoryDeliveryLog(): IOfferDeliveryLog {
  const kept = new Map<string, IOfferDeliveryRecord>();
  return {
    find: (id) => kept.get(id),
    record: (entry) => {
      if (!kept.has(entry.offerId)) kept.set(entry.offerId, entry);
    },
  };
}

export function createFileDeliveryLog(directory: string): IOfferDeliveryLog {
  const path = join(directory, 'offer-delivery.json');
  const read = (): IOfferDeliveryRecord[] => {
    if (!existsSync(path)) return [];
    try {
      const raw = (JSON.parse(readFileSync(path, 'utf8')) as { deliveries?: unknown }).deliveries;
      return Array.isArray(raw)
        ? raw.map(recordOf).filter((entry): entry is IOfferDeliveryRecord => entry !== undefined)
        : [];
    } catch {
      // allow-fallback: this only records what was decided; a file that cannot be read starts empty.
      return [];
    }
  };
  return {
    find: (id) => read().find((entry) => entry.offerId === id),
    record: (entry) => {
      const kept = read();
      if (kept.some((known) => known.offerId === entry.offerId)) return;
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeAtomically(path, { deliveries: [...kept, entry].slice(-DELIVERY_LOG_MAX) });
    },
  };
}
