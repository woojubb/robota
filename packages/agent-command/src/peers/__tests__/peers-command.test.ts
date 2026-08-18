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
  it('lists another live session, and marks which row is this one', () => {
    const result = executePeersCommand(
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

  it('says so plainly when this session is the only one', () => {
    // Not an empty list rendered as a header with nothing under it. "No other live session" is the
    // answer, and it is different from "discovery is unavailable" below.
    const result = executePeersCommand(hostWithPeers([{ sessionId: OWN, liveness: 'alive' }]));
    expect(result.message).toContain('No other live session');
    expect(result.success).toBe(true);
  });

  it('prints `unknown` liveness rather than rounding it to alive', () => {
    // A host that cannot read process start times answers `unknown` for every peer. A reader who is
    // not told that would take a stale entry for a live session — which is the exact guess the
    // registry refuses to make, and it must not be reintroduced by the surface that displays it.
    const result = executePeersCommand(
      hostWithPeers([
        { sessionId: OWN, liveness: 'alive' },
        { sessionId: 'session-other', liveness: 'unknown' },
      ]),
    );
    expect(result.message).toContain('liveness unknown');
  });

  it('does not show a dead entry', () => {
    // A crashed session leaves its file behind. That is debris, not a peer, and offering it as one
    // would make the operator address something that cannot answer.
    const result = executePeersCommand(
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
  it('says the feature is unavailable rather than reporting no peers', () => {
    // The two are different facts and the difference matters: "nobody is there" invites the operator
    // to start a second session, and "this build cannot see them" does not.
    const result = executePeersCommand({
      getCommandHostAdapters: () => ({}),
    } as ICommandHostAdapterAccess);
    expect(result.message).toContain('not available');
    expect(result.message).not.toContain('No other live session');
  });
});
