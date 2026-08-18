/**
 * PEER-004 (#1863) — the composition step, and what it does when a capability cannot be assembled.
 *
 * The unit cases underneath prove the presence leaf and the command. This one proves they are
 * REACHED, which is the half that was missing: the rendezvous directory and the registry both landed
 * and, measured on this tree before this change, no source outside their own modules and tests called
 * either one. Layers passing separately is not the same as the path working.
 */

import { describe, expect, it, vi } from 'vitest';

import { attachCommandHostAdapters } from '../host-action-adapters.js';

import type { RemoteControlController } from '../../remote-control/index.js';
import type { ICommandHostAdapters } from '@robota-sdk/agent-framework';

const CONTROLLER = {
  getStatus: () => ({ state: 'off' as const }),
  listDevices: () => [],
  revokeDevice: () => false,
  enable: () => 'on',
  stop: () => 'off',
} as unknown as RemoteControlController;

function reporter() {
  const said: string[] = [];
  return { said, writeError: (message: string) => said.push(message) };
}

describe('assembling the host adapters', () => {
  it('wires `/peers` to a presence that announced', () => {
    const adapters: ICommandHostAdapters = {};
    const report = reporter();
    const presence = {
      sessionId: 'session-one',
      list: () => [{ sessionId: 'session-one', liveness: 'alive' as const }],
      withdraw: () => undefined,
    };

    attachCommandHostAdapters(adapters, CONTROLLER, report, () => presence);

    expect(adapters.localPeers?.ownSessionId()).toBe('session-one');
    expect(adapters.localPeers?.list()).toEqual([{ sessionId: 'session-one', liveness: 'alive' }]);
    expect(report.said).toEqual([]);
  });

  it('generates the session id here rather than taking one', () => {
    // A session id identifies THIS process for its whole life and has no other source. Asking a
    // caller for one would let two call sites disagree about what a session is, which is the exact
    // question the registry keys its entries on.
    const seen: string[] = [];
    attachCommandHostAdapters({}, CONTROLLER, reporter(), (options) => {
      seen.push(options.sessionId);
      return { sessionId: options.sessionId, list: () => [], withdraw: () => undefined };
    });
    expect(seen[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('REPORTS a refused rendezvous and leaves the adapter unset', () => {
    // Not swallowed, and not fatal. `/peers` then says the feature is unavailable rather than
    // claiming nobody is there — different facts, and the operator acts on the difference: "nobody
    // is there" invites starting a second session, and this does not.
    const adapters: ICommandHostAdapters = {};
    const report = reporter();

    attachCommandHostAdapters(adapters, CONTROLLER, report, () => {
      throw new Error('the rendezvous directory was not admitted');
    });

    expect(adapters.localPeers).toBeUndefined();
    expect(report.said.join(' ')).toContain('not admitted');
    // The rest of the assembly still happened: one capability failing must not take another with it.
    expect(adapters.remoteControl?.getStatus()).toEqual({ state: 'off' });
  });

  it('does not let a refusal stop the session', () => {
    expect(() =>
      attachCommandHostAdapters({}, CONTROLLER, reporter(), () => {
        throw new Error('no');
      }),
    ).not.toThrow();
  });
});
