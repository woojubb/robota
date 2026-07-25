/**
 * CMD-004 Phase 2 (TC-03) — WS e2e: a remote `command` message must apply its host action HOST-SIDE.
 *
 * Pre-Stage-B, `ws-handler.ts` answers a remote command with `command_result` carrying only
 * `message`/`success`/`data` and drops `result.effects` on the floor — a remote `/language ko`
 * replied "Language set" and wrote NOTHING. These tests were recorded FAILING against that state
 * (accidental-green rule; RED run kept in the spec's Evidence Log). Stage B executes host actions in
 * the session's `executeCommand` pipeline via `ICommandHostAdapters` BEFORE the result is sent, and
 * forwards command-issued `ui_intent` events (stamped with the REMOTE-014 E5 server-assigned driver
 * id) so the requesting surface can render screen-navigation intents.
 */

import { describe, expect, it, vi } from 'vitest';
import { InteractiveSession } from '@robota-sdk/agent-framework';
import type { ICommandHostAdapters } from '@robota-sdk/agent-framework';
import {
  createLanguageCommandModule,
  createSettingsCommandModule,
} from '@robota-sdk/agent-command';
import { createWsHandler } from '@robota-sdk/agent-transport-protocol';
import type { TServerMessage } from '@robota-sdk/agent-transport-protocol';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';

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
    getSessionId: () => 'session_ws_tc03',
    getMessageCount: () => 0,
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
  };
}

function setup(adapters: ICommandHostAdapters): {
  sent: TServerMessage[];
  onMessage: (data: string) => void;
} {
  const session = new InteractiveSession({
    session: createRuntimeSession() as never,
    commandModules: [createLanguageCommandModule(), createSettingsCommandModule()],
    commandHostAdapters: adapters,
  });
  const sent: TServerMessage[] = [];
  const { onMessage } = createWsHandler({
    session: session as unknown as IInteractiveSession,
    send: (msg) => sent.push(msg),
    driverId: 'device-e2e-1',
  });
  return { sent, onMessage };
}

async function waitForCommandResult(
  sent: TServerMessage[],
): Promise<Extract<TServerMessage, { type: 'command_result' }>> {
  await vi.waitFor(() => {
    if (!sent.some((m) => m.type === 'command_result')) throw new Error('no command_result yet');
  });
  return sent.find((m) => m.type === 'command_result') as Extract<
    TServerMessage,
    { type: 'command_result' }
  >;
}

describe('CMD-004 TC-03 — remote command host-action application over the WS handler', () => {
  it('a remote /language change WRITES via the settings adapter and requests a restart host-side', async () => {
    const write = vi.fn();
    const requestRestart = vi.fn();
    const { sent, onMessage } = setup({
      settings: { read: () => ({}), write },
      process: { requestExit: vi.fn(), requestRestart },
    });

    onMessage(JSON.stringify({ type: 'command', name: 'language', args: 'ko' }));
    const result = await waitForCommandResult(sent);

    expect(result.success).toBe(true);
    // Host-side application — the exact assertion that FAILS pre-Stage-B (effects dropped).
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ language: 'ko' }));
    expect(requestRestart).toHaveBeenCalledTimes(1);
  });

  it('a remote /settings intent is forwarded as ui_intent stamped with the server-assigned driver id', async () => {
    const { sent, onMessage } = setup({});

    onMessage(JSON.stringify({ type: 'command', name: 'settings', args: '' }));
    await waitForCommandResult(sent);

    // Pre-Stage-B there is NO ui_intent server message at all (silent drop on remote surfaces).
    const intents = sent.filter((m) => m.type === 'ui_intent');
    expect(intents).toEqual([
      {
        type: 'ui_intent',
        event: { intent: { type: 'show-settings' }, requesterDriverId: 'device-e2e-1' },
      },
    ]);
  });
});
