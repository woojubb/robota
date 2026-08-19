/**
 * PEER-004 (#1863) — the composition step, and what it does when a capability cannot be assembled.
 *
 * The unit cases underneath prove the presence leaf and the command. This one proves they are
 * REACHED, which is the half that was missing: the rendezvous directory and the registry both landed
 * and, measured on this tree before this change, no source outside their own modules and tests called
 * either one. Layers passing separately is not the same as the path working.
 */

import { describe, expect, it, vi } from 'vitest';

import { attachHostAdapters, attachLocalPeerMessaging } from '../host-action-adapters.js';

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

    attachHostAdapters(adapters, CONTROLLER, report, () => presence);

    expect(adapters.localPeers?.ownSessionId()).toBe('session-one');
    expect(adapters.localPeers?.list()).toEqual([{ sessionId: 'session-one', liveness: 'alive' }]);
    expect(report.said).toEqual([]);
  });

  it('generates the session id here rather than taking one', () => {
    // A session id identifies THIS process for its whole life and has no other source. Asking a
    // caller for one would let two call sites disagree about what a session is, which is the exact
    // question the registry keys its entries on.
    const seen: string[] = [];
    attachHostAdapters({}, CONTROLLER, reporter(), (options) => {
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

    attachHostAdapters(adapters, CONTROLLER, report, () => {
      throw new Error('the rendezvous directory was not admitted');
    });

    expect(adapters.localPeers).toBeUndefined();
    expect(report.said.join(' ')).toContain('not admitted');
    // The rest of the assembly still happened: one capability failing must not take another with it.
    expect(adapters.remoteControl?.getStatus()).toEqual({ state: 'off' });
  });

  it('does not let a refusal stop the session', () => {
    expect(() =>
      attachHostAdapters({}, CONTROLLER, reporter(), () => {
        throw new Error('no');
      }),
    ).not.toThrow();
  });
});

describe('PEER-006 — messaging is attached separately from discovery', () => {
  const PRESENCE = {
    sessionId: 'me',
    guardedDirectory: '/tmp/does-not-matter',
    list: () => [],
    withdraw: () => {},
  };

  it('fills in `send` once messaging starts', async () => {
    const adapters: ICommandHostAdapters = {};
    attachHostAdapters(adapters, CONTROLLER, reporter(), () => PRESENCE);

    expect(adapters.localPeers?.send).toBeUndefined();

    await attachLocalPeerMessaging(
      adapters,
      PRESENCE,
      () => ({ submit: async () => ({}) }) as never,
      reporter(),
      (async () => ({
        socketPath: '/tmp/x.sock',
        send: async () => ({ id: '1', sequence: 1, state: 'acknowledged' as const }),
        close: async () => {},
      })) as never,
    );

    expect(adapters.localPeers?.send).toBeTypeOf('function');
    await expect(adapters.localPeers?.send?.('other', 'hi')).resolves.toEqual({
      state: 'acknowledged',
    });
  });

  it('leaves discovery working when messaging cannot start', async () => {
    const adapters: ICommandHostAdapters = {};
    const messages: string[] = [];
    const report = { writeError: (message: string) => messages.push(message) };
    attachHostAdapters(adapters, CONTROLLER, reporter(), () => PRESENCE);

    await attachLocalPeerMessaging(adapters, PRESENCE, () => ({}) as never, report, (() =>
      Promise.reject(new Error('the socket could not bind'))) as never);

    // Listing peers and addressing them are different capabilities. Taking discovery down with
    // messaging would turn "I cannot send" into "nobody is there", which invites the wrong action.
    expect(adapters.localPeers?.list).toBeTypeOf('function');
    expect(adapters.localPeers?.send).toBeUndefined();
    expect(messages.join('\n')).toContain('though discovery is on');
  });

  it('does nothing when discovery never came up', async () => {
    const adapters: ICommandHostAdapters = {};
    let started = false;
    await attachLocalPeerMessaging(adapters, undefined, () => ({}) as never, reporter(), (() => {
      started = true;
      return Promise.resolve({}) as never;
    }) as never);

    expect(started).toBe(false);
  });
});
