/**
 * A reply threads a conversation, and a conversation has limits, so two agents answering each other
 * cannot go on forever. Exercised over real sockets: the limits are the carrier's, and only the
 * carrier sees both directions of a conversation.
 */

import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startLocalPeerMessaging } from '../local-peer-messaging.js';

import type { IPeerIngressPort, IPeerMessaging } from '../local-peer-messaging.js';
import type {
  IPeerMessageAck,
  IPeerMessageIngress,
} from '@robota-sdk/agent-interface-session-mobility';

let guardedDirectory: string;

beforeEach(() => {
  guardedDirectory = realpathSync(mkdtempSync(path.join(tmpdir(), 'peer-conv-')));
  rmSync(guardedDirectory, { recursive: true, force: true });
  mkdirSync(guardedDirectory, { mode: 0o700, recursive: true });
});

afterEach(() => rmSync(guardedDirectory, { recursive: true, force: true }));

const alive = () => [
  { sessionId: 'A', liveness: 'alive' as const },
  { sessionId: 'B', liveness: 'alive' as const },
];

/** An ingress that answers every message it receives, as an agent that always replies would. */
function answeringIngress(
  self: () => IPeerMessaging,
  seen: IPeerMessageIngress[],
  replies: IPeerMessageAck[],
): IPeerIngressPort {
  return {
    receive: async (ingress) => {
      seen.push(ingress);
      const { id, sequence, origin } = ingress.message;
      // Answered after the ack, as a turn does, not inside the sender's delivery.
      setTimeout(() => {
        void self()
          .send(origin.sessionId, `re: ${ingress.message.text}`, { inReplyTo: id })
          .then((ack) => replies.push(ack));
      }, 0);
      return { ack: { id, sequence, state: 'pending' } };
    },
  };
}

async function settle(until: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !until(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('peer conversation', () => {
  it('threads a reply to the message it answers', async () => {
    const seenByA: IPeerMessageIngress[] = [];
    let a: IPeerMessaging | undefined;
    let b: IPeerMessaging | undefined;
    b = await startLocalPeerMessaging({
      guardedDirectory,
      sessionId: 'B',
      list: alive,
      ingress: answeringIngress(() => b!, [], []),
      limits: { maxHops: 1, maxRepliesPerConversation: 1 },
    });
    a = await startLocalPeerMessaging({
      guardedDirectory,
      sessionId: 'A',
      list: alive,
      ingress: {
        receive: async (ingress) => {
          seenByA.push(ingress);
          return { ack: { ...ingress.message, state: 'pending' } };
        },
      },
    });

    const first = await a.send('B', 'ping');
    await settle(() => seenByA.length > 0);

    expect(seenByA[0]?.message.text).toBe('re: ping');
    expect(seenByA[0]?.message.inReplyTo).toBe(first.id);
    await a.close();
    await b.close();
  });

  it('stops a ping-pong between two agents that always answer, and tells each operator', async () => {
    const seen: IPeerMessageIngress[] = [];
    const replies: IPeerMessageAck[] = [];
    const reports: string[] = [];
    const limits = { maxHops: 6, maxRepliesPerConversation: 10 };
    let a: IPeerMessaging | undefined;
    let b: IPeerMessaging | undefined;
    a = await startLocalPeerMessaging({
      guardedDirectory,
      sessionId: 'A',
      list: alive,
      ingress: answeringIngress(() => a!, seen, replies),
      report: (message) => reports.push(`A ${message}`),
      limits,
    });
    b = await startLocalPeerMessaging({
      guardedDirectory,
      sessionId: 'B',
      list: alive,
      ingress: answeringIngress(() => b!, seen, replies),
      report: (message) => reports.push(`B ${message}`),
      limits,
    });

    await a.send('B', 'ping');
    await settle(() => replies.some((ack) => ack.state === 'refused'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Hops 1..6 were delivered; the seventh reply was never sent.
    expect(seen).toHaveLength(7);
    const refused = replies.filter((ack) => ack.state === 'refused');
    expect(refused).toHaveLength(1);
    expect(refused[0]?.reason).toMatch(/limit/);
    expect(reports.some((line) => /limit/.test(line))).toBe(true);
    await a.close();
    await b.close();
  });

  it('holds a turn budget: one session answers a conversation only so many times', async () => {
    const seenByA: IPeerMessageIngress[] = [];
    let b: IPeerMessaging | undefined;
    const reports: string[] = [];
    b = await startLocalPeerMessaging({
      guardedDirectory,
      sessionId: 'B',
      list: alive,
      ingress: {
        receive: async (ingress) => ({ ack: { ...ingress.message, state: 'pending' } }),
      },
      report: (message) => reports.push(message),
      limits: { maxHops: 50, maxRepliesPerConversation: 2 },
    });
    const a = await startLocalPeerMessaging({
      guardedDirectory,
      sessionId: 'A',
      list: alive,
      ingress: {
        receive: async (ingress) => {
          seenByA.push(ingress);
          return { ack: { ...ingress.message, state: 'pending' } };
        },
      },
    });

    const first = await a.send('B', 'ping');
    const acks = [];
    for (let i = 0; i < 3; i += 1)
      acks.push(await b.send('A', `answer ${i}`, { inReplyTo: first.id }));

    expect(acks.map((ack) => ack.state)).toEqual(['pending', 'pending', 'refused']);
    expect(reports).toHaveLength(1);
    await a.close();
    await b.close();
  });

  it('refuses a reply to a message this session never received from that peer', async () => {
    const reports: string[] = [];
    const b = await startLocalPeerMessaging({
      guardedDirectory,
      sessionId: 'B',
      list: alive,
      ingress: { receive: async (ingress) => ({ ack: { ...ingress.message, state: 'pending' } }) },
      report: (message) => reports.push(message),
    });

    const ack = await b.send('A', 'answer', { inReplyTo: 'never-seen' });

    expect(ack.state).toBe('refused');
    await b.close();
  });
});
