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
  'file',
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

  it.each(['observe', 'drive'] as const)(
    'refuses cached %s after its connection signal aborts',
    async (cap) => {
      const operator = approver(true);
      const authority = new ConnectionAuthority(peer(), operator);
      const connection = new AbortController();
      await expect(authority.authorize(cap, { signal: connection.signal })).resolves.toEqual({
        allowed: true,
      });
      connection.abort();
      await expect(authority.authorize(cap)).resolves.toEqual({
        allowed: false,
        reason: 'declined',
      });
      expect(operator.requests).toHaveLength(1);
    },
  );

  it.each(['presence', 'message'] as const)(
    'refuses %s on an already aborted connection',
    async (cap) => {
      const authority = new ConnectionAuthority(peer());
      const connection = new AbortController();
      connection.abort();
      await expect(authority.authorize(cap, { signal: connection.signal })).resolves.toEqual({
        allowed: false,
        reason: 'declined',
      });
    },
  );

  it('cannot widen the admitted capabilities by mutating the input after construction', async () => {
    const capabilities: TMeshCapability[] = ['presence'];
    const admitted = peer({ capabilities });
    const operator = approver(true);
    const authority = new ConnectionAuthority(admitted, operator);
    capabilities.push('drive');
    await expect(authority.authorize('drive')).resolves.toEqual({
      allowed: false,
      reason: 'not-granted',
    });
    expect(operator.requests).toHaveLength(0);
  });

  it('does not reuse a cached approval for a caller that aborted while sharing an outstanding ask', async () => {
    let resolve!: (answer: boolean) => void;
    const operator = approver(
      () =>
        new Promise<boolean>((res) => {
          resolve = res;
        }),
    );
    const authority = new ConnectionAuthority(peer(), operator);
    const first = authority.authorize('drive');
    const connection = new AbortController();
    const second = authority.authorize('drive', { signal: connection.signal });
    connection.abort();
    resolve(true);
    await expect(first).resolves.toEqual({ allowed: true });
    await expect(second).resolves.toEqual({ allowed: false, reason: 'declined' });
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
      expect(signal?.aborted).toBe(false);
      leaving.abort();
      expect(signal?.aborted).toBe(true);
      return true;
    });
    const authority = new ConnectionAuthority(peer(), { approve });
    await expect(authority.authorize('observe', { signal: leaving.signal })).resolves.toEqual({
      allowed: false,
      reason: 'declined',
    });
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it('closing the carrier refuses every capability, including cached approvals', async () => {
    const operator = approver(true);
    const authority = new ConnectionAuthority(peer(), operator);
    await authority.authorize('drive');
    await authority.authorize('observe');
    authority.close();
    authority.close();
    for (const capability of ALL) {
      await expect(authority.authorize(capability)).resolves.toEqual({
        allowed: false,
        reason: 'declined',
      });
    }
    expect(operator.requests).toHaveLength(2);
  });

  it('closing withdraws an outstanding question even if the approver never settles', async () => {
    let signal: AbortSignal | undefined;
    const authority = new ConnectionAuthority(peer(), {
      approve: (_request, active) => {
        signal = active;
        return new Promise<boolean>(() => {});
      },
    });
    const pending = authority.authorize('drive');
    authority.close();
    expect(signal?.aborted).toBe(true);
    await expect(pending).resolves.toEqual({ allowed: false, reason: 'declined' });
  });

  it('request cancellation settles a question even if the approver never settles', async () => {
    const authority = new ConnectionAuthority(
      peer(),
      approver(() => new Promise<boolean>(() => {})),
    );
    const connection = new AbortController();
    const pending = authority.authorize('delegate', { signal: connection.signal });
    connection.abort();
    await expect(pending).resolves.toEqual({ allowed: false, reason: 'declined' });
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

  it('asks the operator for every file transfer, showing name, size and hash', async () => {
    const operator = approver(true);
    const authority = new ConnectionAuthority(peer(), operator);
    const offer = { name: 'notes.txt', size: 12, sha256: 'a'.repeat(64) };

    await expect(authority.authorizeFile(offer)).resolves.toEqual({ allowed: true });
    await expect(authority.authorizeFile(offer)).resolves.toEqual({ allowed: true });

    expect(operator.requests).toHaveLength(2);
    expect(operator.requests[0]).toMatchObject({ capability: 'file', scope: 'request' });
    expect(operator.requests[0]?.summary).toContain('notes.txt');
    expect(operator.requests[0]?.summary).toContain('12 bytes');
    expect(operator.requests[0]?.summary).toContain('a'.repeat(64));
  });

  it('refuses a file transfer nobody approved', async () => {
    await expect(
      new ConnectionAuthority(peer(), approver(false)).authorizeFile({
        name: 'x',
        size: 1,
        sha256: 'b'.repeat(64),
      }),
    ).resolves.toEqual({ allowed: false, reason: 'declined' });
    await expect(
      new ConnectionAuthority(peer()).authorizeFile({ name: 'x', size: 1, sha256: 'b'.repeat(64) }),
    ).resolves.toEqual({ allowed: false, reason: 'no-approver' });
    await expect(
      new ConnectionAuthority(peer({ capabilities: ['message'] }), approver(true)).authorizeFile({
        name: 'x',
        size: 1,
        sha256: 'b'.repeat(64),
      }),
    ).resolves.toEqual({ allowed: false, reason: 'not-granted' });
  });
});
