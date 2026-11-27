/**
 * Delivery stores: values held in memory (for tests, and for a host that keeps state elsewhere) and
 * owner-only files `settings.json` and `state.json`, each rewritten atomically.
 *
 * The two files fail differently on purpose. The limits are the person's words, so a limits file that
 * cannot be read as valid limits is an error: nothing is pushed until it is fixed, rather than pushing
 * under limits the person did not choose. The counters only bound how much is pushed in a day, so a
 * counters file that cannot be read starts the day afresh.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_DELIVERY_SETTINGS, DeliveryRefusedError, applySettingsChange } from './policy.js';

import type { IDeliverySettings, IDeliveryState, IDeliveryStore, IPendingOffer } from './types.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/u;
export const PENDING_DIGEST_MAX = 50;
export const OFFER_SOURCES_MAX = 50;

export function createMemoryDeliveryStore<T>(initial?: T): IDeliveryStore<T> {
  let held = initial;
  return {
    read: async () => held,
    write: async (value) => {
      held = value;
    },
  };
}

function readJson(path: string): unknown {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as unknown) : undefined;
}

function writeJson(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

/** The counters as stored, or `undefined` when they are not what this module writes. */
function stateOf(raw: unknown): IDeliveryState | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { day, sent, digestedOn, pendingDigest, offerSources, pendingOffers } = raw as Record<
    string,
    unknown
  >;
  if (typeof day !== 'string' || !DAY.test(day)) return undefined;
  if (typeof sent !== 'number' || !Number.isInteger(sent) || sent < 0) return undefined;
  if (digestedOn !== undefined && (typeof digestedOn !== 'string' || !DAY.test(digestedOn)))
    return undefined;
  if (!Array.isArray(pendingDigest)) return undefined;
  return {
    day,
    sent,
    ...(digestedOn !== undefined && { digestedOn }),
    pendingDigest: pendingDigest
      .filter((id): id is string => typeof id === 'string')
      .slice(-PENDING_DIGEST_MAX),
    ...offerFieldsOf(offerSources, pendingOffers),
  };
}

/** The offer fields, which a file written before offers existed lacks; entries that are not valid are dropped. */
function offerFieldsOf(
  offerSources: unknown,
  pendingOffers: unknown,
): Pick<IDeliveryState, 'offerSources' | 'pendingOffers'> {
  const kept: [string, string][] = [];
  if (typeof offerSources === 'object' && offerSources !== null && !Array.isArray(offerSources))
    for (const [key, value] of Object.entries(offerSources))
      if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) kept.push([key, value]);
  const sources = kept
    .sort(([, a], [, b]) => Date.parse(a) - Date.parse(b))
    .slice(-OFFER_SOURCES_MAX);
  const offers = Array.isArray(pendingOffers)
    ? pendingOffers
        .filter(
          (entry): entry is IPendingOffer =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as IPendingOffer).offerId === 'string' &&
            typeof (entry as IPendingOffer).title === 'string',
        )
        .map(({ offerId, title }) => ({ offerId, title }))
        .slice(-PENDING_DIGEST_MAX)
    : [];
  return {
    ...(sources.length > 0 && { offerSources: Object.fromEntries(sources) }),
    ...(offers.length > 0 && { pendingOffers: offers }),
  };
}

export function createFileDeliveryStores(directory: string): {
  readonly settings: IDeliveryStore<IDeliverySettings>;
  readonly state: IDeliveryStore<IDeliveryState>;
} {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const settingsPath = join(directory, 'settings.json');
  const statePath = join(directory, 'state.json');
  return {
    settings: {
      read: async () => {
        try {
          const stored = readJson(settingsPath);
          return stored === undefined
            ? undefined
            : applySettingsChange(DEFAULT_DELIVERY_SETTINGS, stored);
        } catch (failure) {
          throw new DeliveryRefusedError(
            `The delivery settings file cannot be used (${failure instanceof Error ? failure.message : String(failure)}); fix or remove ${settingsPath}`,
          );
        }
      },
      write: async (value) => writeJson(settingsPath, value),
    },
    state: {
      read: async () => {
        try {
          return stateOf(readJson(statePath));
        } catch {
          // allow-fallback: the counters only bound a day's pushes, so a file that cannot be read starts the day afresh.
          return undefined;
        }
      },
      write: async (value) => writeJson(statePath, value),
    },
  };
}
