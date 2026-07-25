/**
 * CMD-004 Stage D (TC-09) — WS e2e: the MULTI-SURFACE exit/restart policy.
 *
 * The spec's deliberate decision (local == remote, REMOTE-006): host-executed `session-exit` /
 * `session-restart` invoked from a REMOTE surface terminate/restart the SHARED HOST serving ALL
 * attached surfaces — exit/restart are session-scoped semantics, not surface-scoped ones. A surface
 * that only wants to detach disconnects; `/exit` ends the session for everyone.
 *
 * Placement: this e2e needs a REAL `InteractiveSession` (agent-framework, a runtime dependency of
 * this package) under real `createWsHandler` surfaces (agent-transport-protocol, a devDependency) —
 * agent-transport is the Stage-D-owned package that legitimately sees both sides.
 */

import { createExitCommandModule, createLanguageCommandModule } from '@robota-sdk/agent-command';
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { createWsHandler } from '@robota-sdk/agent-transport-protocol';
import { describe, expect, it, vi } from 'vitest';

import type { ICommandHostAdapters } from '@robota-sdk/agent-framework';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';
import type { TServerMessage } from '@robota-sdk/agent-transport-protocol';

function createRuntimeSession(): Record<string, unknown> {
  return {
    run: vi.fn().mockResolvedValue('answer'),
    abort: vi.fn(),
    clearHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    injectMessage: vi.fn(),
    getContextState: () => ({
      maxTokens: 100,
      usedTokens: 0,
      usedPercentage: 0,
      remainingPercentage: 100,
    }),
    getSessionId: () => 'session_tc09',
    getMessageCount: () => 0,
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
  };
}

interface ISurface {
  sent: TServerMessage[];
  onMessage: (data: string) => void;
}

/** ONE shared host session with TWO attached remote WS surfaces (device-A / device-B). */
function setupSharedHost(adapters: ICommandHostAdapters): {
  session: InteractiveSession;
  surfaceA: ISurface;
  surfaceB: ISurface;
} {
  const session = new InteractiveSession({
    session: createRuntimeSession() as never,
    commandModules: [createExitCommandModule(), createLanguageCommandModule()],
    commandHostAdapters: adapters,
  });
  const attach = (driverId: string): ISurface => {
    const sent: TServerMessage[] = [];
    const { onMessage } = createWsHandler({
      session: session as unknown as IInteractiveSession,
      send: (msg) => sent.push(msg),
      driverId,
    });
    return { sent, onMessage };
  };
  return { session, surfaceA: attach('device-A'), surfaceB: attach('device-B') };
}

async function waitFor<T extends TServerMessage['type']>(
  sent: TServerMessage[],
  type: T,
): Promise<Extract<TServerMessage, { type: T }>> {
  await vi.waitFor(() => {
    if (!sent.some((m) => m.type === type)) throw new Error(`no ${type} yet`);
  });
  return sent.find((m) => m.type === type) as Extract<TServerMessage, { type: T }>;
}

describe('CMD-004 TC-09 — multi-surface exit/restart acts on the SHARED host (local == remote)', () => {
  it("a remote /exit from surface A terminates the shared host serving BOTH surfaces — not just surface A's attachment", async () => {
    const requestExit = vi.fn();
    const requestRestart = vi.fn();
    const { surfaceA, surfaceB } = setupSharedHost({
      process: { requestExit, requestRestart },
    });

    surfaceA.onMessage(JSON.stringify({ type: 'command', name: 'exit', args: '' }));

    // With interactive surfaces attached, /exit self-asks for confirmation over the transport-neutral
    // ask seam; the parked ask BROADCASTS to both co-driving surfaces (REMOTE-007) …
    const askA = await waitFor(surfaceA.sent, 'ask_request');
    const askB = await waitFor(surfaceB.sent, 'ask_request');
    expect(askB.event.id).toBe(askA.event.id);

    // … and the REQUESTING surface confirms.
    surfaceA.onMessage(
      JSON.stringify({
        type: 'ask-response',
        id: askA.event.id,
        response: { type: 'answer', values: ['yes'] },
      }),
    );

    const result = await waitFor(surfaceA.sent, 'command_result');
    expect(result.success).toBe(true);

    // THE policy assertion: the ONE shared process adapter exits the host — session-scoped, for
    // every surface — exactly once. No surface-scoped teardown happens instead of it.
    expect(requestExit).toHaveBeenCalledTimes(1);
    expect(requestExit).toHaveBeenCalledWith('prompt_input_exit');
    expect(requestRestart).not.toHaveBeenCalled();

    // The command result goes to the REQUESTER only; the host action is what the other surface shares.
    expect(surfaceB.sent.some((m) => m.type === 'command_result')).toBe(false);
  });

  it('a remote /language (restart host action) from surface B restarts the SHARED host once', async () => {
    const write = vi.fn();
    const requestExit = vi.fn();
    const requestRestart = vi.fn();
    const { surfaceA, surfaceB } = setupSharedHost({
      settings: { read: () => ({}), write },
      process: { requestExit, requestRestart },
    });

    surfaceB.onMessage(JSON.stringify({ type: 'command', name: 'language', args: 'ko' }));
    const result = await waitFor(surfaceB.sent, 'command_result');

    expect(result.success).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    // One shared host, one restart — despite TWO attached surfaces (no per-surface duplication).
    expect(requestRestart).toHaveBeenCalledTimes(1);
    expect(requestRestart).toHaveBeenCalledWith('other', 'Language change restart');
    expect(surfaceA.sent.some((m) => m.type === 'command_result')).toBe(false);
  });

  it('local == remote: a LOCAL /exit produces the IDENTICAL shared-host call as the remote one', async () => {
    const requestExit = vi.fn();
    // Zero attached surfaces → no interactive confirm (the headless embedding); the host action runs.
    const session = new InteractiveSession({
      session: createRuntimeSession() as never,
      commandModules: [createExitCommandModule()],
      commandHostAdapters: { process: { requestExit, requestRestart: vi.fn() } },
    });

    const result = await session.executeCommand('exit', '', 'user');

    expect(result?.success).toBe(true);
    // Same adapter call, same args as the remote-surface path above — the REMOTE-006 owner principle.
    expect(requestExit).toHaveBeenCalledTimes(1);
    expect(requestExit).toHaveBeenCalledWith('prompt_input_exit');
  });
});
