/**
 * The delivery policy as pure functions: the person's limits, how a partial change to them is checked,
 * and what becomes of one question. The agent suggests an urgency; the limits decide. A question the
 * limits do not let through is never lost: it waits for the digest or stays in the feed.
 */
import type { TCaseUrgency } from '../cases/types.js';
import type { IDeliverySettings, IQuietHours, TDelivery } from './types.js';

export const DAILY_LIMIT_MAX = 20;

export const DEFAULT_DELIVERY_SETTINGS: IDeliverySettings = {
  dailyLimit: 3,
  quietHours: { enabled: true, from: '22:00', to: '08:00' },
  digest: { enabled: true, at: '08:00' },
};

export class DeliveryRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'DeliveryRefusedError';
  }
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/u;

/** Minutes since midnight of an `HH:MM` time. */
export function minutesOf(time: string): number {
  const match = TIME.exec(time);
  if (match === null) throw new DeliveryRefusedError(`${time} is not a time of day (HH:MM)`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes since local midnight. */
export function localMinutes(at: Date): number {
  return at.getHours() * 60 + at.getMinutes();
}

/** The local day as `YYYY-MM-DD`. */
export function localDay(at: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** Whether `at` is inside the window: from its start up to, not including, its end; it may cross midnight. */
export function inQuietHours(quiet: IQuietHours, at: Date): boolean {
  if (!quiet.enabled) return false;
  const from = minutesOf(quiet.from);
  const to = minutesOf(quiet.to);
  const now = localMinutes(at);
  return from < to ? now >= from && now < to : now >= from || now < to;
}

export interface IDecideDeliveryInput {
  readonly urgency: TCaseUrgency;
  readonly now: Date;
  readonly settings: IDeliverySettings;
  /** How many questions were already pushed immediately on the local day of `now`. */
  readonly sentToday: number;
}

/**
 * `feed` stays in the feed. `digest` waits for the daily summary, or stays in the feed when there is
 * none. `now` is pushed unless the person's quiet hours or daily limit say otherwise, and then it is
 * held like a `digest`.
 */
export function decideDelivery(input: IDecideDeliveryInput): TDelivery {
  const { urgency, now, settings, sentToday } = input;
  if (urgency === 'feed') return 'feed';
  const held: TDelivery = settings.digest.enabled ? 'digest' : 'feed';
  if (urgency === 'digest') return held;
  if (inQuietHours(settings.quietHours, now) || sentToday >= settings.dailyLimit) return held;
  return 'notify';
}

function plainObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new DeliveryRefusedError(`${what} must be an object`);
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new DeliveryRefusedError(`${what} has no setting named ${key}`);
}

function flag(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw new DeliveryRefusedError(`${what} must be true or false`);
  return value;
}

function time(value: unknown, what: string): string {
  if (typeof value !== 'string' || !TIME.test(value))
    throw new DeliveryRefusedError(`${what} must be a time of day as HH:MM, from 00:00 to 23:59`);
  return value;
}

/**
 * The limits as they stand after a partial change: only what the change names is replaced. Anything
 * else is refused, and a refusal says why in plain words, so a mistyped limit is never silently
 * dropped or bent into range. The same check judges a stored file, so a limit that is not valid is
 * never acted on.
 */
export function applySettingsChange(
  current: IDeliverySettings,
  change: unknown,
): IDeliverySettings {
  const body = plainObject(change, 'The change');
  onlyKeys(body, ['dailyLimit', 'quietHours', 'digest'], 'Delivery');
  let { dailyLimit, quietHours, digest } = current;
  if (body['dailyLimit'] !== undefined) {
    const value = body['dailyLimit'];
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > DAILY_LIMIT_MAX
    )
      throw new DeliveryRefusedError(
        `The daily limit must be a whole number from 0 to ${DAILY_LIMIT_MAX}`,
      );
    dailyLimit = value;
  }
  if (body['quietHours'] !== undefined) {
    const quiet = plainObject(body['quietHours'], 'Quiet hours');
    onlyKeys(quiet, ['enabled', 'from', 'to'], 'Quiet hours');
    quietHours = {
      enabled:
        quiet['enabled'] === undefined
          ? quietHours.enabled
          : flag(quiet['enabled'], 'Quiet hours on or off'),
      from:
        quiet['from'] === undefined ? quietHours.from : time(quiet['from'], 'Quiet hours start'),
      to: quiet['to'] === undefined ? quietHours.to : time(quiet['to'], 'Quiet hours end'),
    };
    if (quietHours.from === quietHours.to)
      throw new DeliveryRefusedError(
        'Quiet hours must start and end at different times; turn them off instead of making them empty',
      );
  }
  if (body['digest'] !== undefined) {
    const summary = plainObject(body['digest'], 'The digest');
    onlyKeys(summary, ['enabled', 'at'], 'The digest');
    digest = {
      enabled:
        summary['enabled'] === undefined
          ? digest.enabled
          : flag(summary['enabled'], 'The digest on or off'),
      at: summary['at'] === undefined ? digest.at : time(summary['at'], 'The digest time'),
    };
  }
  return { dailyLimit, quietHours, digest };
}
