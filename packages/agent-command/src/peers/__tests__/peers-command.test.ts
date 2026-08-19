/**
 * PEER-004 (#1863) — `/peers` is the surface that makes local discovery observable.
 *
 * Discovery landed as two leaves — a guarded rendezvous directory and a registry whose liveness is
 * settled by pid AND process start time — and measured on this tree before this command existed, no
 * source outside those modules and their tests called either one. A discovery layer nobody can look
 * at is one nobody can catch being wrong, so what these cases pin is the READING: what an operator
 * is told, and in particular what they are told when the answer is "I could not determine".
 */

import { describe, expect, it } from 'vitest';

import { executePeersCommand } from '../peers-command.js';

import type { ICommandHostAdapterAccess, ICommandHostAdapters } from '@robota-sdk/agent-framework';

type TPeerSummary = ReturnType<NonNullable<ICommandHostAdapters['localPeers']>['list']>[number];

const OWN = 'session-self';

function hostWithPeers(peers: readonly TPeerSummary[]): ICommandHostAdapterAccess {
  return {
    getCommandHostAdapters: () => ({
      localPeers: { list: () => peers, ownSessionId: () => OWN },
    }),
  } as ICommandHostAdapterAccess;
}

describe('what the operator is told', () => {
  it('lists another live session, and marks which row is this one', async () => {
    const result = await executePeersCommand(
      hostWithPeers([
        { sessionId: OWN, liveness: 'alive' },
        { sessionId: 'session-other', name: 'review', liveness: 'alive' },
      ]),
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain('session-other');
    expect(result.message).toContain('review');
    expect(result.message).toMatch(/session-self.*\(this session\)/);
  });

  it('says so plainly when this session is the only one', async () => {
    // Not an empty list rendered as a header with nothing under it. "No other live session" is the
    // answer, and it is different from "discovery is unavailable" below.
    const result = await executePeersCommand(
      hostWithPeers([{ sessionId: OWN, liveness: 'alive' }]),
    );
    expect(result.message).toContain('No other live session');
    expect(result.success).toBe(true);
  });

  it('prints `unknown` liveness rather than rounding it to alive', async () => {
    // A host that cannot read process start times answers `unknown` for every peer. A reader who is
    // not told that would take a stale entry for a live session — which is the exact guess the
    // registry refuses to make, and it must not be reintroduced by the surface that displays it.
    const result = await executePeersCommand(
      hostWithPeers([
        { sessionId: OWN, liveness: 'alive' },
        { sessionId: 'session-other', liveness: 'unknown' },
      ]),
    );
    expect(result.message).toContain('liveness unknown');
  });

  it('does not show a dead entry', async () => {
    // A crashed session leaves its file behind. That is debris, not a peer, and offering it as one
    // would make the operator address something that cannot answer.
    const result = await executePeersCommand(
      hostWithPeers([
        { sessionId: OWN, liveness: 'alive' },
        { sessionId: 'session-gone', liveness: 'dead' },
      ]),
    );
    expect(result.message).not.toContain('session-gone');
    expect(result.message).toContain('No other live session');
  });
});

describe('when the host wires no discovery', () => {
  it('says the feature is unavailable rather than reporting no peers', async () => {
    // The two are different facts and the difference matters: "nobody is there" invites the operator
    // to start a second session, and "this build cannot see them" does not.
    const result = await executePeersCommand({
      getCommandHostAdapters: () => ({}),
    } as ICommandHostAdapterAccess);
    expect(result.message).toContain('not available');
    expect(result.message).not.toContain('No other live session');
  });
});

describe('PEER-006 — /peers send', () => {
  function hostWithSend(
    send: (target: string, text: string) => Promise<{ state: string; reason?: string }>,
  ): ICommandHostAdapterAccess {
    return {
      getCommandHostAdapters: () => ({
        localPeers: {
          list: () => [{ sessionId: 'other', liveness: 'alive' as const }],
          ownSessionId: () => OWN,
          send,
        },
      }),
    } as unknown as ICommandHostAdapterAccess;
  }

  it('passes the whole message, not just its first word', async () => {
    const calls: Array<[string, string]> = [];
    await executePeersCommand(
      hostWithSend(async (target, text) => {
        calls.push([target, text]);
        return { state: 'acknowledged' };
      }),
      'send other look at the failing test in cli.ts',
    );

    expect(calls).toEqual([['other', 'look at the failing test in cli.ts']]);
  });

  it('reports `pending` as waiting, never as delivered', async () => {
    const result = await executePeersCommand(
      hostWithSend(async () => ({ state: 'pending' })),
      'send other hello',
    );

    // The operator has to be able to see the wait. "Delivered" here would hide a turn already
    // running on the other side, which is the one thing they might want to act on.
    expect(result.message).toContain('waiting');
    expect(result.message).not.toContain('Delivered');
    expect(result.success).toBe(true);
  });

  it('carries the refusal reason back to the operator', async () => {
    const result = await executePeersCommand(
      hostWithSend(async () => ({ state: 'refused', reason: 'no session ghost is announced' })),
      'send ghost hello',
    );

    expect(result.message).toContain('no session ghost is announced');
    expect(result.success).toBe(false);
  });

  it('explains what it needs when the message is missing', async () => {
    const result = await executePeersCommand(
      hostWithSend(async () => ({ state: 'acknowledged' })),
      'send other',
    );

    expect(result.message).toContain('Usage: /peers send');
    expect(result.success).toBe(false);
  });

  it('does not read a session id beginning with `send` as the subcommand', async () => {
    // `startsWith('send')` would claim this as `/peers send`, leaving `er-1` as the target.
    const result = await executePeersCommand(
      hostWithSend(async () => ({ state: 'acknowledged' })),
      'sender-1',
    );

    expect(result.message).toContain('Live sessions:');
  });

  it('says so when the host can discover peers but not address them', async () => {
    const result = await executePeersCommand(
      {
        getCommandHostAdapters: () => ({
          localPeers: { list: () => [], ownSessionId: () => OWN },
        }),
      } as ICommandHostAdapterAccess,
      'send other hello',
    );

    expect(result.message).toContain('cannot address them');
    expect(result.success).toBe(false);
  });
});
