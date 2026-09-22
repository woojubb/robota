/**
 * TC-13: a transient, an authentication, a configuration and a not-found failure each classify
 * distinctly, and only the transient class is retried; the other three are refused on first response
 * rather than retried blindly (MCP-003).
 */
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { describe, expect, it } from 'vitest';

import { FakeSupervisorClock, fixtureTimeouts } from './supervisor-test-helpers.js';
import { MCPSessionError } from '../client/session.js';
import { classifyMcpFailure, MCPConnectionSupervisor } from '../supervisor/connection.js';

describe('classifyMcpFailure — pure classification (TC-13)', () => {
  it('classifies a network/timeout shape as transient', () => {
    expect(
      classifyMcpFailure(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })),
    ).toBe('transient');
    expect(classifyMcpFailure(new Error('operation timed out after 500ms'))).toBe('transient');
    expect(
      classifyMcpFailure(Object.assign(new Error('Internal Server Error'), { status: 503 })),
    ).toBe('transient');
  });

  it('classifies an UnauthorizedError / 401 / 403 shape as auth', () => {
    expect(classifyMcpFailure(new UnauthorizedError())).toBe('auth');
    expect(classifyMcpFailure(Object.assign(new Error('Forbidden'), { status: 403 }))).toBe('auth');
    expect(classifyMcpFailure(new Error('401 Unauthorized'))).toBe('auth');
  });

  it('classifies an unsupported-protocol-version / invalid-params shape as config', () => {
    expect(classifyMcpFailure(new MCPSessionError('unsupported-protocol-version', 'nope'))).toBe(
      'config',
    );
    expect(classifyMcpFailure(Object.assign(new Error('Invalid params'), { code: -32602 }))).toBe(
      'config',
    );
    expect(classifyMcpFailure(new TypeError('Invalid URL'))).toBe('config');
  });

  it('classifies a 404 / method-not-found shape as not-found', () => {
    expect(classifyMcpFailure(Object.assign(new Error('Not Found'), { status: 404 }))).toBe(
      'not-found',
    );
    expect(classifyMcpFailure(Object.assign(new Error('Method not found'), { code: -32601 }))).toBe(
      'not-found',
    );
  });
});

describe('MCPConnectionSupervisor — only transient schedules a retry (TC-13)', () => {
  it('schedules a retry after a transient connect failure', async () => {
    const clock = new FakeSupervisorClock();
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'server-1',
      openSession: async () => {
        throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
      },
      timeouts: fixtureTimeouts(),
      clock,
    });

    await expect(supervisor.ensureConnected()).rejects.toThrow();

    const state = supervisor.getState();
    expect(state).toMatchObject({ kind: 'failed', classification: 'transient', retry: 'pending' });
    expect(clock.pendingCount).toBe(1);
  });

  it.each([
    ['auth', () => new UnauthorizedError()],
    ['config', () => new MCPSessionError('unsupported-protocol-version', 'nope')],
    ['not-found', () => Object.assign(new Error('Not Found'), { status: 404 })],
  ] as const)(
    'refuses a %s failure on first response with no retry timer armed',
    async (classification, makeError) => {
      const clock = new FakeSupervisorClock();
      const supervisor = new MCPConnectionSupervisor({
        serverId: 'server-1',
        openSession: async () => {
          throw makeError();
        },
        timeouts: fixtureTimeouts(),
        clock,
      });

      await expect(supervisor.ensureConnected()).rejects.toThrow();

      const state = supervisor.getState();
      expect(state).toMatchObject({ kind: 'failed', classification, retry: 'manual-retry' });
      expect(clock.pendingCount).toBe(0);
    },
  );
});
