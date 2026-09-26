import { describe, expect, it, vi } from 'vitest';

import {
  ConnectionAuthority,
  type ICapabilityApprovalRequest,
  type IConnectionPeer,
  type IOperatorApprover,
} from '../connection-authority.js';

import type { TMeshCapability } from '../mesh-admission-contracts.js';

const ALL: readonly TMeshCapability[] = [
  'delegate',
  'drive',
  'handoff',
  'message',
  'observe',
  'presence',
];

function peer(over: Partial<IConnectionPeer> = {}): IConnectionPeer {
  return {
    deviceId: 'dev-laptop',
    sessionId: 'session-laptop',
    locality: 'another-host',
    capabilities: ALL,
    ...over,
  };
}

function approver(answer: boolean | (() => Promise<boolean>)): IOperatorApprover & {
  requests: ICapabilityApprovalRequest[];
} {
  const requests: ICapabilityApprovalRequest[] = [];
  return {
    requests,
    approve: vi.fn(async (request: ICapabilityApprovalRequest) => {
      requests.push(request);
      return typeof answer === 'function' ? answer() : answer;
    }),
  };
}

describe('ConnectionAuthority', () => {
  it.each(['presence', 'message'] as const)(
    'allows %s without asking the operator',
    async (cap) => {
      const operator = approver(false);
      const authority = new ConnectionAuthority(peer(), operator);
      await expect(authority.authorize(cap)).resolves.toEqual({ allowed: true });
      expect(operator.requests).toHaveLength(0);
    },
  );

  it.each(['observe', 'drive'] as const)('refuses an unapproved %s', async (cap) => {
    const operator = approver(false);
    const authority = new ConnectionAuthority(peer(), operator);
    await expect(authority.authorize(cap)).resolves.toEqual({ allowed: false, reason: 'declined' });
    expect(operator.requests).toEqual([
      { capability: cap, scope: 'connection', deviceId: 'dev-laptop', locality: 'another-host' },
    ]);
  });

  it.each(['observe', 'drive'] as const)(
    'refuses %s when no operator can be asked, without waiting on anyone',
    async (cap) => {
      const authority = new ConnectionAuthority(peer());
      await expect(authority.authorize(cap)).resolves.toEqual({
        allowed: false,
        reason: 'no-approver',
      });
    },
  );

  it('asks once per connection for observe and drive, and a new connection asks again', async () => {
    const operator = approver(true);
    const first = new ConnectionAuthority(peer(), operator);
    await expect(first.authorize('drive')).resolves.toEqual({ allowed: true });
    await expect(first.authorize('drive')).resolves.toEqual({ allowed: true });
    // Two concurrent asks on one connection are one question.
    await Promise.all([first.authorize('observe'), first.authorize('observe')]);
    expect(operator.requests.map((r) => r.capability)).toEqual(['drive', 'observe']);

    const second = new ConnectionAuthority(peer(), operator);
    await second.authorize('drive');
    expect(operator.requests.map((r) => r.capability)).toEqual(['drive', 'observe', 'drive']);
  });

  it('keeps a declined connection declined instead of asking again', async () => {
    const operator = approver(false);
    const authority = new ConnectionAuthority(peer(), operator);
    await authority.authorize('drive');
    await expect(authority.authorize('drive')).resolves.toEqual({
      allowed: false,
      reason: 'declined',
    });
    expect(operator.requests).toHaveLength(1);
  });

  it('treats an approver that fails as a refusal', async () => {
    const authority = new ConnectionAuthority(
      peer(),
      approver(() => Promise.reject(new Error('terminal gone'))),
    );
    await expect(authority.authorize('observe')).resolves.toEqual({
      allowed: false,
      reason: 'declined',
    });
  });

  it('does not ask about a connection that is already gone', async () => {
    const operator = approver(true);
    const authority = new ConnectionAuthority(peer(), operator);
    const gone = new AbortController();
    gone.abort();
    await expect(authority.authorize('drive', { signal: gone.signal })).resolves.toEqual({
      allowed: false,
      reason: 'declined',
    });
    expect(operator.requests).toHaveLength(0);
  });

  it('hands the approver the signal, and a yes after the connection went away is a no', async () => {
    const leaving = new AbortController();
    const approve = vi.fn(async (_request: ICapabilityApprovalRequest, signal?: AbortSignal) => {
      expect(signal).toBe(leaving.signal);
      leaving.abort();
      return true;
    });
    const authority = new ConnectionAuthority(peer(), { approve });
    await expect(authority.authorize('observe', { signal: leaving.signal })).resolves.toEqual({
      allowed: false,
      reason: 'declined',
    });
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it('refuses a capability the admission did not grant, without asking', async () => {
    const operator = approver(true);
    const authority = new ConnectionAuthority(peer({ capabilities: ['presence'] }), operator);
    for (const cap of ['message', 'drive', 'observe', 'delegate'] as const) {
      await expect(authority.authorize(cap)).resolves.toEqual({
        allowed: false,
        reason: 'not-granted',
      });
    }
    expect(operator.requests).toHaveLength(0);
  });

  it('asks the operator for every delegated request, showing the task', async () => {
    const operator = approver(true);
    const authority = new ConnectionAuthority(peer(), operator);
    await authority.authorizeDelegation({ requestId: 'r1', task: 'run the tests' });
    await authority.authorizeDelegation({ requestId: 'r2', task: 'run the tests' });
    expect(operator.requests).toEqual([
      {
        capability: 'delegate',
        scope: 'request',
        deviceId: 'dev-laptop',
        locality: 'another-host',
        summary: 'run the tests',
      },
      {
        capability: 'delegate',
        scope: 'request',
        deviceId: 'dev-laptop',
        locality: 'another-host',
        summary: 'run the tests',
      },
    ]);
  });

  it('refuses a delegated request the operator declines or cannot be asked about', async () => {
    const declined = new ConnectionAuthority(peer(), approver(false));
    await expect(
      declined.authorizeDelegation({ requestId: 'r1', task: 'deploy' }),
    ).resolves.toEqual({ allowed: false, reason: 'declined' });
    const unattended = new ConnectionAuthority(peer());
    await expect(
      unattended.authorizeDelegation({ requestId: 'r1', task: 'deploy' }),
    ).resolves.toEqual({ allowed: false, reason: 'no-approver' });
  });

  it('runs an approved delegated task as a peer turn answered to the admitted sender', async () => {
    const authority = new ConnectionAuthority(peer({ locality: 'same-host' }), approver(true));
    // Whatever else the sender put on the request is not carried: the receiver's policy decides.
    const wire = {
      requestId: 'r1',
      task: 'clean up',
      permissionMode: 'bypassPermissions',
      allowedTools: ['Bash'],
      reach: 'same-host',
      turnSource: 'user',
      driverId: 'owner',
    };
    const decision = await authority.authorizeDelegation(wire);
    expect(decision).toEqual({
      allowed: true,
      turn: {
        input: 'clean up',
        options: {
          turnSource: 'peer',
          driverId: 'peer:dev-laptop',
          peer: { messageId: 'r1', replyTo: 'session-laptop' },
        },
      },
    });
  });
});
