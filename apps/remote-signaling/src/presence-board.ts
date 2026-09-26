/**
 * Device inboxes on the relay: a connection declares the opaque topics it is present at, and a
 * `message` to a topic reaches the one connection present there — or comes back `absent`.
 *
 * Topics are opaque to the relay. Devices derive them from a secret only the two ends of a pair can
 * compute, so the relay cannot tell which device or user a topic belongs to, and knowing a topic is
 * what addressing it takes. A topic has one holder: a newer declaration takes it over, because the
 * common case is the same device reconnecting while its previous connection has not been noticed
 * as gone yet, and refusing it would lock the device out of its own inbox.
 */

/** The part of a relay connection the board needs. */
export interface IPresencePeer {
  readonly id: string;
  /** The source the relay's other per-source limits key by. */
  readonly remoteAddress?: string;
}

/** Most topics one connection may be present at (one per peer device). */
export const MAX_TOPICS_PER_CONNECTION = 64;
/** Default ceiling on topics held relay-wide. */
export const DEFAULT_MAX_PRESENCE_TOPICS = 8192;
/**
 * Default ceiling on topics one source holds across its connections, so a few sources cannot fill
 * the relay-wide ceiling and lock every other device out.
 */
export const DEFAULT_MAX_PRESENCE_TOPICS_PER_SOURCE = 256;

/** High-entropy base64url; a short topic would be guessable and could be squatted by a stranger. */
const TOPIC = /^[A-Za-z0-9_-]{32,128}$/;

export type TPresenceRefusal = 'invalid-topic' | 'too-many-topics' | 'not-present';

export function isTopic(value: unknown): value is string {
  return typeof value === 'string' && TOPIC.test(value);
}

/** The topics of a `presence` frame, or undefined when the list is not acceptable. */
export function parseTopics(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length === 0 || value.length > MAX_TOPICS_PER_CONNECTION) return undefined;
  if (!value.every(isTopic)) return undefined;
  return [...new Set(value as string[])];
}

function sourceOf(peer: IPresencePeer): string {
  return peer.remoteAddress ?? peer.id;
}

export class PresenceBoard<TPeer extends IPresencePeer> {
  private readonly holders = new Map<string, TPeer>();
  private readonly byPeer = new Map<string, Set<string>>();
  private readonly bySource = new Map<string, number>();

  public constructor(
    private readonly maxTopics: number = DEFAULT_MAX_PRESENCE_TOPICS,
    private readonly maxTopicsPerSource: number = DEFAULT_MAX_PRESENCE_TOPICS_PER_SOURCE,
  ) {}

  /** Replace `peer`'s topics with `topics`. Refused when a relay-wide or per-source ceiling would be passed. */
  public declare(peer: TPeer, topics: readonly string[]): TPresenceRefusal | undefined {
    const own = this.byPeer.get(peer.id) ?? new Set<string>();
    const source = sourceOf(peer);
    let total = this.holders.size - own.size;
    let fromSource = (this.bySource.get(source) ?? 0) - own.size;
    for (const topic of topics) {
      const holder = this.holders.get(topic);
      if (holder === undefined || holder === peer) {
        total += 1;
        fromSource += 1;
      } else if (sourceOf(holder) !== source) {
        fromSource += 1;
      }
    }
    if (total > this.maxTopics || fromSource > this.maxTopicsPerSource) return 'too-many-topics';

    this.withdraw(peer);
    const next = new Set<string>();
    for (const topic of topics) {
      this.release(topic);
      this.holders.set(topic, peer);
      this.bySource.set(source, (this.bySource.get(source) ?? 0) + 1);
      next.add(topic);
    }
    this.byPeer.set(peer.id, next);
    return undefined;
  }

  private release(topic: string): void {
    const holder = this.holders.get(topic);
    if (holder === undefined) return;
    this.holders.delete(topic);
    this.byPeer.get(holder.id)?.delete(topic);
    const source = sourceOf(holder);
    const remaining = (this.bySource.get(source) ?? 1) - 1;
    if (remaining <= 0) this.bySource.delete(source);
    else this.bySource.set(source, remaining);
  }

  public isPresent(peer: TPeer): boolean {
    return (this.byPeer.get(peer.id)?.size ?? 0) > 0;
  }

  /** The connection present at `topic`, other than `sender`. */
  public holderOf(topic: string, sender: TPeer): TPeer | undefined {
    const holder = this.holders.get(topic);
    return holder === sender ? undefined : holder;
  }

  /** Drop every topic `peer` holds. */
  public withdraw(peer: TPeer): void {
    const own = this.byPeer.get(peer.id);
    if (own === undefined) return;
    for (const topic of [...own]) if (this.holders.get(topic) === peer) this.release(topic);
    this.byPeer.delete(peer.id);
  }

  public get size(): number {
    return this.holders.size;
  }
}
