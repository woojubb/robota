/**
 * The browsers the person has asked to be notified in when the page is closed. A browser's push address
 * is a capability: whoever holds it can make that browser show a notification. So the list is kept like
 * a credential, in an owner-only file of its own, and nothing outside this module can read it back: the
 * page is told how many browsers are subscribed and no more, and no answer, log line or error repeats
 * an address or a key. Only the person's own request, through the routes, adds or removes one.
 *
 * Whether an address may be reached is the host's outbound-request policy, asked when it is added and
 * again by the request that sends. A browser's push service is a public host, so a loopback or private
 * destination is refused unless the owner named its host.
 */
import { createECDH } from 'node:crypto';

import { DeliveryRefusedError } from '@robota-sdk/agent-product/personal';

import { createOwnerFile } from './owner-file.js';

/** What a browser gives when it subscribes, and all that is kept of it. */
export interface IPushSubscription {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

/** Browsers kept at most; a sixth takes the place of the oldest. */
export const PUSH_SUBSCRIPTION_LIMIT = 5;

export interface IPushSubscriptions {
  count(): number;
  /** Whether this browser's address is currently kept. */
  has(endpoint: unknown): boolean;
  /** For the sink that sends. Not reachable from any route. */
  list(): readonly IPushSubscription[];
  /** Keep this browser, replacing any named earlier addresses before applying the limit. */
  add(input: unknown): Promise<number>;
  /** Forget the browser with this address, if kept; the count afterwards. */
  remove(endpoint: unknown): number;
  /** Forget a browser whose push service says the address is gone. */
  drop(endpoint: string): void;
  clear(): void;
}

export interface IPushSubscriptionsOptions {
  readonly directory: string;
  /** Why this destination may not be reached, or `undefined` when it may; the words name no address. */
  readonly admit: (url: URL) => Promise<string | undefined>;
}

const FILE = 'push-subscriptions.json';
const ENDPOINT_LIMIT = 2048;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;

/** The bytes a canonical URL-safe base64 value stands for, or `undefined` when it is anything else. */
function bytesOf(value: unknown): Buffer | undefined {
  if (typeof value !== 'string' || !BASE64URL.test(value)) return undefined;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.toString('base64url') === value ? bytes : undefined;
}

/** Whether these bytes are a point on the curve browsers use, which is what a message is encrypted to. */
function isPublicKey(bytes: Buffer): boolean {
  if (bytes.length !== 65 || bytes[0] !== 0x04) return false;
  try {
    // Agreeing a secret with it is what fails for a point that is not on the curve.
    const own = createECDH('prime256v1');
    own.generateKeys();
    own.computeSecret(bytes);
    return true;
  } catch {
    // allow-fallback: a point off the curve is a key that is not valid, which is the answer.
    return false;
  }
}

function endpointOf(value: unknown): URL {
  if (typeof value !== 'string' || value.trim() === '')
    throw new DeliveryRefusedError('The push address must be a web address');
  if (value.length > ENDPOINT_LIMIT)
    throw new DeliveryRefusedError(`The push address must be at most ${ENDPOINT_LIMIT} characters`);
  if (!URL.canParse(value))
    throw new DeliveryRefusedError('The push address is not a valid web address');
  const url = new URL(value);
  if (url.protocol !== 'https:')
    throw new DeliveryRefusedError('The push address must start with https://');
  if (url.username !== '' || url.password !== '')
    throw new DeliveryRefusedError('The push address must not hold a user name or password');
  return url;
}

/** What a browser sent, checked; every refusal is in words that repeat none of it. */
function parse(input: unknown): { readonly url: URL; readonly subscription: IPushSubscription } {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new DeliveryRefusedError('The subscription must be an object');
  const { endpoint, keys } = input as Record<string, unknown>;
  const url = endpointOf(endpoint);
  if (typeof keys !== 'object' || keys === null || Array.isArray(keys))
    throw new DeliveryRefusedError('The subscription must carry its p256dh and auth keys');
  const { p256dh, auth } = keys as Record<string, unknown>;
  const publicKey = bytesOf(p256dh);
  if (publicKey === undefined || !isPublicKey(publicKey))
    throw new DeliveryRefusedError('The p256dh key is not a valid public key');
  if (bytesOf(auth)?.length !== 16)
    throw new DeliveryRefusedError('The auth secret must be 16 bytes in URL-safe base64');
  return {
    url,
    subscription: { endpoint: url.href, keys: { p256dh: p256dh as string, auth: auth as string } },
  };
}

/** One stored entry, or `undefined` when it is not what this module writes. */
function entryOf(raw: unknown): IPushSubscription | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { endpoint, keys } = raw as Record<string, unknown>;
  if (typeof endpoint !== 'string' || typeof keys !== 'object' || keys === null) return undefined;
  const { p256dh, auth } = keys as Record<string, unknown>;
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return undefined;
  return { endpoint, keys: { p256dh, auth } };
}

export function createPushSubscriptions(options: IPushSubscriptionsOptions): IPushSubscriptions {
  const file = createOwnerFile(options.directory, FILE);
  /** A file that cannot be read as a list means no browser: nothing is sent until one subscribes again. */
  const read = (): IPushSubscription[] => {
    try {
      const stored = file.read();
      const list = (stored as { subscriptions?: unknown } | undefined)?.subscriptions;
      return Array.isArray(list)
        ? list.map(entryOf).filter((entry): entry is IPushSubscription => entry !== undefined)
        : [];
    } catch {
      // allow-fallback: a file that cannot be read means no browser, so nothing is sent.
      return [];
    }
  };
  const write = (subscriptions: readonly IPushSubscription[]): void =>
    file.write({ subscriptions });
  const forget = (endpoint: string): number => {
    const held = read();
    const kept = held.filter((entry) => entry.endpoint !== endpoint);
    if (kept.length !== held.length) write(kept);
    return kept.length;
  };
  return {
    count: () => read().length,
    has: (endpoint) => {
      const address = endpointOf(endpoint).href;
      return read().some((entry) => entry.endpoint === address);
    },
    list: read,
    add: async (input) => {
      const { url, subscription } = parse(input);
      const replacing = (input as Record<string, unknown>)['replacing'];
      if (replacing !== undefined && !Array.isArray(replacing))
        throw new DeliveryRefusedError('The earlier push addresses must be a list');
      const previous = new Set((replacing ?? []).map((entry: unknown) => endpointOf(entry).href));
      const refusal = await options.admit(url);
      if (refusal !== undefined)
        throw new DeliveryRefusedError(`The push address (${url.host}) cannot be used: ${refusal}`);
      const kept = [
        ...read().filter(
          (entry) => entry.endpoint !== subscription.endpoint && !previous.has(entry.endpoint),
        ),
        subscription,
      ].slice(-PUSH_SUBSCRIPTION_LIMIT);
      write(kept);
      return kept.length;
    },
    remove: (endpoint) => forget(endpointOf(endpoint).href),
    drop: (endpoint) => void forget(endpoint),
    clear: () => write([]),
  };
}
