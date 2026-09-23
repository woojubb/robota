import { describe, expect, it, vi } from 'vitest';
import { MCPConnectionSupervisor } from '@robota-sdk/agent-mcp';

import { createMcpExternalEventHost } from '../mcp-external-event-host.js';

import type { IExternalEventSourceOptions, IExternalEventSource } from '@robota-sdk/agent-framework';
import type { IMCPExternalEvent, IMCPSession } from '@robota-sdk/agent-mcp';

const EVENT: IMCPExternalEvent = { senderId: 'alice', conversationId: 'chat', content: 'hello' };

describe('MCP external event host binding', () => {
  it('needs both a launch grant and a connected capability before submitting a turn', async () => {
    let listener: ((event: IMCPExternalEvent) => void) | undefined;
    let options: IExternalEventSourceOptions | undefined;
    const closeSource = vi.fn();
    const unsubscribe = vi.fn();
    const received: unknown[] = [];
    const diagnostics: string[] = [];
    const source: IExternalEventSource = {
      receive: async (raw) => {
        const authenticated = await options?.authenticate(raw);
        if (authenticated) received.push(authenticated);
        return { outcome: authenticated ? 'accepted' : 'ignored' };
      },
      close: closeSource,
    };
    const host = createMcpExternalEventHost(
      ['chat:alice', 'chat:bob'],
      { subscribeExternalEvent: (_serverId, next) => {
        listener = next;
        return { ok: true as const, unsubscribe };
      } },
      (message) => diagnostics.push(message),
    );
    await host.bind({ openExternalEventSource: async (next) => { options = next; return source; } });
    expect(options?.id).toBe('chat');
    expect(options?.allowedSenders).toEqual(['alice', 'bob']);
    expect(await options?.authenticate(EVENT)).toBeNull();
    listener?.(EVENT);
    await Promise.resolve();
    expect(received).toEqual([EVENT]);
    expect(diagnostics).toContain('External event source "chat" enabled for 2 sender(s).');
    host.close();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(closeSource).toHaveBeenCalledOnce();
  });

  it('reports a refused server and closes its session source without accepting events', async () => {
    const closeSource = vi.fn();
    const diagnostics: string[] = [];
    const host = createMcpExternalEventHost(
      ['chat:alice'],
      { subscribeExternalEvent: () => ({ ok: false as const, reason: 'capability absent' }) },
      (message) => diagnostics.push(message),
    );
    await host.bind({ openExternalEventSource: async () => ({
      receive: async () => ({ outcome: 'ignored' }),
      close: closeSource,
    }) });
    expect(closeSource).toHaveBeenCalledOnce();
    expect(diagnostics).toEqual(['External event source "chat" refused: capability absent']);
  });

  it('moves the subscription to a replacement TUI session without retaining the old source', async () => {
    let listener: ((event: IMCPExternalEvent) => void) | undefined;
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const firstReceive = vi.fn(async () => ({ outcome: 'ignored' as const }));
    const secondReceive = vi.fn(async () => ({ outcome: 'ignored' as const }));
    const host = createMcpExternalEventHost(
      ['chat:alice'],
      { subscribeExternalEvent: (_id, next) => {
        listener = next;
        return { ok: true as const, unsubscribe: () => { listener = undefined; } };
      } },
      () => undefined,
    );
    await host.bind({ openExternalEventSource: async () => ({ receive: firstReceive, close: firstClose }) });
    await host.bind({ openExternalEventSource: async () => ({ receive: secondReceive, close: secondClose }) });
    expect(firstClose).toHaveBeenCalledOnce();
    listener?.(EVENT);
    await Promise.resolve();
    expect(firstReceive).not.toHaveBeenCalled();
    expect(secondReceive).toHaveBeenCalledOnce();
    host.close();
    expect(secondClose).toHaveBeenCalledOnce();
  });

  it('keeps supervisor recovery alive while replacing a TUI source during backoff', async () => {
    vi.useFakeTimers();
    try {
      const sessions = Array.from({ length: 2 }, () => {
        const closeListeners = new Set<() => void>();
        const eventListeners = new Set<(event: IMCPExternalEvent) => void>();
        const session: IMCPSession = {
          identity: { serverId: 'chat', serverName: 'Chat', serverVersion: '1', protocolVersion: '2025-06-18' },
          declaredCapabilities: { tools: undefined, prompts: undefined, resources: undefined },
          externalEventsDeclared: true,
          discover: async () => { throw new Error('not used'); },
          callTool: async () => ({ content: [], isError: false }),
          onListChanged: () => () => undefined,
          onExternalEvent: (listener) => {
            eventListeners.add(listener);
            return () => { eventListeners.delete(listener); };
          },
          onClose: (listener) => {
            closeListeners.add(listener);
            return () => { closeListeners.delete(listener); };
          },
          close: async () => undefined,
        };
        return {
          session,
          disconnect: () => { for (const listener of [...closeListeners]) listener(); },
          emit: (event: IMCPExternalEvent) => { for (const listener of eventListeners) listener(event); },
        };
      });
      let opens = 0;
      const supervisor = new MCPConnectionSupervisor({
        serverId: 'chat',
        openSession: async () => sessions[opens++]!.session,
        timeouts: { startupMs: 1_000, perCallMs: 1_000, globalDefaultMs: 1_000, idleMs: 1_000, toolCallMs: 1_000 },
        backoff: { initialMs: 10, maxAttempts: 2 },
      });
      await supervisor.ensureConnected();
      const received: unknown[] = [];
      const host = createMcpExternalEventHost(
        ['chat:alice'],
        { subscribeExternalEvent: (_id, listener) => ({
          ok: true as const,
          unsubscribe: supervisor.onExternalEvent(listener),
        }) },
        () => undefined,
      );
      const source = {
        receive: vi.fn(async (raw: unknown) => {
          received.push(raw);
          return { outcome: 'ignored' as const };
        }),
        close: vi.fn(),
      };
      await host.bind({ openExternalEventSource: async () => source });
      sessions[0]!.disconnect();
      expect(supervisor.getState()).toMatchObject({ kind: 'failed', retry: 'pending' });
      await host.bind({ openExternalEventSource: async () => source });
      await vi.advanceTimersByTimeAsync(10);
      expect(supervisor.getState().kind).toBe('connected');
      sessions[1]!.emit(EVENT);
      await Promise.resolve();
      expect(received).toHaveLength(1);
      host.close();
      await supervisor.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });
});
