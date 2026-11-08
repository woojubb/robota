/**
 * The relay port a device mesh node signals through: be present at inbox topics, send an opaque
 * message to a topic, and hear back when nobody is present there.
 *
 * The relay is untrusted. It sees only opaque topics and signaling blobs; everything a node reads
 * from it is decoded as hostile input, and admission never depends on it.
 */

import type { IMeshPeerRoute } from './mesh-discovery.js';

export interface IMeshRelay {
  /** Be present at exactly these topics (replaces any earlier declaration). */
  declarePresence(topics: readonly string[]): void;
  /** Deliver `data` to whoever is present at `topic`. */
  send(topic: string, data: unknown): void;
  /** Messages delivered to a topic this relay client is present at. Returns an unsubscribe. */
  onMessage(handler: (topic: string, data: unknown) => void): () => void;
  /** Nobody was present at `topic` when a message was sent there. Returns an unsubscribe. */
  onAbsent(handler: (topic: string) => void): () => void;
  /**
   * The peers the node signals now (replaces any earlier declaration), for a relay that looks for
   * peers itself rather than only delivering to topics.
   */
  declarePeers?(peers: readonly IMeshPeerRoute[]): void;
  /** A connection to `deviceId` was admitted: the way its signals went worked. */
  confirmPeer?(deviceId: string): void;
  close(): void;
}

export interface IInMemoryMeshRelayHub {
  /** A new relay client attached to this hub. */
  connect(): IMeshRelay;
}

/**
 * An in-process relay hub with the relay's delivery rules — for tests and loopback only: one holder
 * per topic (the newest), never an echo to the sender, `absent` when nobody holds the topic.
 * Deliveries run on a microtask, as a network would never deliver synchronously.
 */
export function createInMemoryMeshRelayHub(): IInMemoryMeshRelayHub {
  interface IClient {
    readonly messages: Set<(topic: string, data: unknown) => void>;
    readonly absents: Set<(topic: string) => void>;
    topics: Set<string>;
    open: boolean;
  }
  const holders = new Map<string, IClient>();

  return {
    connect(): IMeshRelay {
      const self: IClient = {
        messages: new Set(),
        absents: new Set(),
        topics: new Set(),
        open: true,
      };
      const withdraw = (): void => {
        for (const topic of self.topics) if (holders.get(topic) === self) holders.delete(topic);
        self.topics = new Set();
      };
      return {
        declarePresence(topics) {
          if (!self.open) return;
          withdraw();
          self.topics = new Set(topics);
          for (const topic of topics) holders.set(topic, self);
        },
        send(topic, data) {
          if (!self.open) return;
          // Cross the boundary as JSON, as a real relay would.
          const copy: unknown = JSON.parse(JSON.stringify(data));
          queueMicrotask(() => {
            const holder = holders.get(topic);
            if (holder === undefined || holder === self || !holder.open) {
              for (const handler of self.absents) handler(topic);
              return;
            }
            for (const handler of holder.messages) handler(topic, copy);
          });
        },
        onMessage(handler) {
          self.messages.add(handler);
          return () => self.messages.delete(handler);
        },
        onAbsent(handler) {
          self.absents.add(handler);
          return () => self.absents.delete(handler);
        },
        close() {
          self.open = false;
          withdraw();
          self.messages.clear();
          self.absents.clear();
        },
      };
    },
  };
}
