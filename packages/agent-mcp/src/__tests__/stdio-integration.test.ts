import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { createStdioAdapter } from '../client/stdio.js';
import { MCPStdioTransport } from '../client/stdio-transport.js';
import { MCPStdioError } from '../client/stdio-transport.js';
import { openMcpSession } from '../client/session.js';
import { MCPConnectionSupervisor } from '../supervisor/connection.js';
import { classifyMcpFailure } from '../supervisor/connection.js';
import { MCPActivationAdmissionService } from '../mcp-activation.js';
import { MCPDefinitionRegistry } from '../definition/registry.js';

import { FakeSupervisorClock, fixtureTimeouts } from './supervisor-test-helpers.js';

const fixturePath = fileURLToPath(
  new URL('../../examples/stdio-fixture-server.mjs', import.meta.url),
);

async function setup(mode: string) {
  const root = await mkdtemp(join(tmpdir(), 'mcp-stdio-test-'));
  const definition = {
    name: 'fixture',
    source: 'project' as const,
    origin: 'fixture',
    transport: 'stdio' as const,
    command: process.execPath,
    args: [fixturePath, mode],
    unsetVariables: [],
  };
  const request = new MCPDefinitionRegistry(
    [
      {
        name: definition.name,
        source: definition.source,
        origin: definition.origin,
        status: 'resolved',
        definition,
        shadowed: [],
      },
    ],
    { workspace: { repositoryKey: root, trustState: 'trusted', generation: 1 } },
  ).list()[0];
  if (request === undefined) throw Error('missing request');
  const service = new MCPActivationAdmissionService();
  service.approve(request);
  const adapter = createStdioAdapter({
    admission: service,
    authority: {
      allowedRoot: root,
      generation: '1',
      executables: [{ command: process.execPath, args: [[fixturePath, mode]] }],
      environment: { HOME: root },
    },
  });
  const admission = await adapter.admit({ definition, activation: request });
  if (!admission.ok) throw Error(`admission failed: ${admission.reason}`);
  const transport = adapter.construct(admission.admitted);
  if (!(transport instanceof MCPStdioTransport)) throw Error('wrong transport');
  return { root, service, request, transport, adapter, admitted: admission.admitted };
}

/** A startup budget for cases that exercise what happens after startup, not startup itself. */
const STARTUP_BUDGET_MS = 10_000;

describe('bounded stdio lifecycle with the SDK client', () => {
  it('discovers, calls, captures negotiation, drains stderr, and observes child close', async () => {
    const fixture = await setup('stderr');
    try {
      const session = await openMcpSession({
        serverId: 'fixture',
        transport: fixture.transport,
        timeouts: { startupMs: 3_000, perCallMs: 3_000 },
      });
      try {
        const discovery = await session.discover({ maxPages: 5, perRequestTimeoutMs: 3_000 });
        const call = await session.callTool('ping', {});
        expect(discovery.tools.items.map((tool) => tool.name)).toEqual(['ping']);
        expect(call.content[0]?.['text']).toBe('pong');
        expect(session.identity.protocolVersion).toMatch(/^20/);
        expect(fixture.transport.pid).toBeTypeOf('number');
        expect(JSON.stringify(fixture.transport.stderrSummary)).not.toContain('secret-fixture');
      } finally {
        await session.close();
      }
      expect(fixture.transport.closedDirectChild).toBe(true);
      expect(fixture.transport.stderrSummary).toEqual({ bytes: 65_536, truncated: true });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('closes the child when one stdout frame exceeds the receive bound', async () => {
    expect(classifyMcpFailure(new MCPStdioError('receive-limit'))).toBe('config');
    const fixture = await setup('oversized-stdio');
    try {
      const session = await openMcpSession({
        serverId: 'fixture',
        transport: fixture.transport,
        timeouts: { startupMs: 3_000, perCallMs: 5_000 },
      });
      try {
        await expect(session.callTool('ping', {})).rejects.toThrow();
      } finally {
        await session.close();
      }
      expect(fixture.transport.closedDirectChild).toBe(true);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 10_000);

  it('does not spawn an admitted snapshot after activation is revoked', async () => {
    const fixture = await setup('normal');
    try {
      fixture.service.revoke(fixture.request);
      await expect(fixture.transport.start()).rejects.toThrow('authority');
      expect(fixture.transport.pid).toBeNull();
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('requires manual retry when activation is revoked before a supervised stdio open', async () => {
    const fixture = await setup('normal');
    const clock = new FakeSupervisorClock();
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'fixture',
      awaitOpenCleanupOnTimeout: true,
      openSession: (signal) =>
        openMcpSession({
          serverId: 'fixture',
          transport: fixture.transport,
          timeouts: { startupMs: 2_000, perCallMs: 2_000 },
          signal,
        }),
      timeouts: fixtureTimeouts(),
      backoff: { maxAttempts: 2 },
      clock,
    });
    try {
      fixture.service.revoke(fixture.request);
      await expect(supervisor.ensureConnected()).rejects.toThrow('Stdio transport authority');
      expect(supervisor.getState()).toMatchObject({
        kind: 'failed',
        classification: 'config',
        retry: 'manual-retry',
        attempt: 1,
      });
      expect(clock.pendingCount).toBe(0);
      expect(fixture.transport.pid).toBeNull();
    } finally {
      await supervisor.shutdown();
      await fixture.transport.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('refuses revocation during asynchronous path validation before spawn', async () => {
    const fixture = await setup('normal');
    try {
      const starting = fixture.transport.start();
      fixture.service.revoke(fixture.request);
      await expect(starting).rejects.toThrow('authority');
      expect(fixture.transport.pid).toBeNull();
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('reserves a single start before asynchronous authority checks', async () => {
    const fixture = await setup('normal');
    try {
      const results = await Promise.allSettled([
        fixture.transport.start(),
        fixture.transport.start(),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      await fixture.transport.close();
      expect(fixture.transport.closedDirectChild).toBe(true);
    } finally {
      await fixture.transport.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('notifies close once even when shutdown is repeated after the child exits', async () => {
    const fixture = await setup('normal');
    const onclose = vi.fn();
    fixture.transport.onclose = onclose;
    try {
      await fixture.transport.start();
      await fixture.transport.close();
      await fixture.transport.close();
      expect(onclose).toHaveBeenCalledTimes(1);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('redacts an early child exit and completes cleanup', async () => {
    const fixture = await setup('early-exit');
    try {
      await expect(
        openMcpSession({
          serverId: 'fixture',
          transport: fixture.transport,
          timeouts: { startupMs: 2_000, perCallMs: 2_000 },
        }),
      ).rejects.toThrow(/Stdio session startup failed/);
      expect(fixture.transport.closedDirectChild).toBe(true);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('bounds cancellation and observes a child that ignores graceful termination', async () => {
    const fixture = await setup('stall');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      await expect(
        openMcpSession({
          serverId: 'fixture',
          transport: fixture.transport,
          timeouts: { startupMs: 1_000, perCallMs: 1_000 },
          signal: controller.signal,
        }),
      ).rejects.toThrow(/Stdio session startup/);
      expect(fixture.transport.closedDirectChild).toBe(true);
    } finally {
      clearTimeout(timer);
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 10_000);

  it('closes an active child when a tool ignores request cancellation', async () => {
    const fixture = await setup('hang-call');
    try {
      const session = await openMcpSession({
        serverId: 'fixture',
        transport: fixture.transport,
        timeouts: { startupMs: 2_000, perCallMs: 2_000 },
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 100);
      try {
        const call = session.callTool('ping', {}, { signal: controller.signal, timeoutMs: 1_000 });
        const rejected = expect(call).rejects.toThrow('Stdio transport cancelled');
        await new Promise((resolve) => setTimeout(resolve, 200));
        await session.close();
        expect(fixture.transport.closedDirectChild).toBe(true);
        await rejected;
      } finally {
        clearTimeout(timer);
        await session.close();
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 10_000);

  it('supervisor shutdown waits for a pending stdio open to clean up', async () => {
    const fixture = await setup('stall');
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'fixture',
      awaitOpenCleanupOnTimeout: true,
      openSession: (signal) =>
        openMcpSession({
          serverId: 'fixture',
          transport: fixture.transport,
          timeouts: { startupMs: 2_000, perCallMs: 2_000 },
          signal,
        }),
      timeouts: {
        startupMs: 2_000,
        perCallMs: 2_000,
        globalDefaultMs: 10_000,
        idleMs: 10_000,
        toolCallMs: 2_000,
      },
      backoff: { maxAttempts: 1 },
    });
    try {
      const rejected = expect(supervisor.discover()).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await supervisor.shutdown();
      expect(fixture.transport.closedDirectChild).toBe(true);
      await rejected;
    } finally {
      await fixture.transport.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 10_000);

  it('supervisor waits for direct-child cleanup before a startup timeout settles', async () => {
    const fixture = await setup('stall');
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'fixture',
      awaitOpenCleanupOnTimeout: true,
      openSession: (signal) =>
        openMcpSession({
          serverId: 'fixture',
          transport: fixture.transport,
          timeouts: { startupMs: 500, perCallMs: 500 },
          signal,
        }),
      timeouts: {
        startupMs: 500,
        perCallMs: 500,
        globalDefaultMs: 10_000,
        idleMs: 10_000,
        toolCallMs: 500,
      },
      backoff: { maxAttempts: 1 },
    });
    try {
      await expect(supervisor.discover()).rejects.toThrow();
      await supervisor.shutdown();
      expect(fixture.transport.closedDirectChild).toBe(true);
    } finally {
      await fixture.transport.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 10_000);

  it('supervisor retires a self-closed stdio session and reconnects on the next request', async () => {
    const fixture = await setup('hang-call');
    const transports = [fixture.transport];
    let opens = 0;
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'fixture',
      awaitOpenCleanupOnTimeout: true,
      openSession: (signal) => {
        opens += 1;
        const transport =
          opens === 1 ? fixture.transport : fixture.adapter.construct(fixture.admitted);
        if (transport !== fixture.transport && 'closedDirectChild' in transport)
          transports.push(transport);
        return openMcpSession({
          serverId: 'fixture',
          transport,
          timeouts: { startupMs: STARTUP_BUDGET_MS, perCallMs: 2_000 },
          signal,
        });
      },
      timeouts: {
        startupMs: STARTUP_BUDGET_MS,
        perCallMs: 2_000,
        globalDefaultMs: 100,
        idleMs: 10_000,
        toolCallMs: 5_000,
      },
      backoff: { maxAttempts: 1 },
    });
    try {
      // Establish the session outside the 100ms call budget; this case exercises a post-startup close.
      await supervisor.ensureConnected();
      await expect(supervisor.callTool('ping', {})).rejects.toThrow();
      expect(fixture.transport.closedDirectChild).toBe(true);
      expect(supervisor.getState().kind).toBe('idle');
      await supervisor.ensureConnected();
      expect(opens).toBe(2);
    } finally {
      await supervisor.shutdown();
      for (const transport of transports) await transport.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 30_000);

  it.each(['discover', 'call'] as const)(
    'retires a child that exits after initialization during %s',
    async (operation) => {
      const fixture = await setup('normal');
      const transports = [fixture.transport];
      let opens = 0;
      const supervisor = new MCPConnectionSupervisor({
        serverId: 'fixture',
        awaitOpenCleanupOnTimeout: true,
        openSession: (signal) => {
          opens += 1;
          const transport =
            opens === 1 ? fixture.transport : fixture.adapter.construct(fixture.admitted);
          if (transport instanceof MCPStdioTransport && transport !== fixture.transport)
            transports.push(transport);
          return openMcpSession({
            serverId: 'fixture',
            transport,
            timeouts: { startupMs: 2_000, perCallMs: 2_000 },
            signal,
          });
        },
        timeouts: {
          startupMs: 2_000,
          perCallMs: 2_000,
          globalDefaultMs: 10_000,
          idleMs: 10_000,
          toolCallMs: 2_000,
        },
        backoff: { maxAttempts: 1 },
      });
      try {
        await supervisor.ensureConnected();
        const pid = fixture.transport.pid;
        if (pid === null) throw Error('missing fixture child');
        process.kill(pid, 'SIGTERM');
        await vi.waitFor(() => expect(fixture.transport.closedDirectChild).toBe(true));
        const request = () =>
          operation === 'discover' ? supervisor.discover() : supervisor.callTool('ping', {});
        await expect(request()).rejects.toThrow();
        expect(supervisor.getState().kind).toBe('idle');
        await request();
        expect(opens).toBe(2);
      } finally {
        await supervisor.shutdown();
        for (const transport of transports) await transport.close();
        await rm(fixture.root, { recursive: true, force: true });
      }
    },
    10_000,
  );
});
