// @vitest-environment jsdom
/**
 * #3186 — command output and tool calls belong to the conversation timeline, as the TUI renders
 * them, not to banners stacked above it.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useSessionClient } from '../useSessionClient.js';

import type { TMakeSessionClient } from '../useSessionClient.js';
import type { TServerMessage } from '@robota-sdk/agent-transport';

function setup(): {
  result: { current: ReturnType<typeof useSessionClient> };
  deliver: (msg: TServerMessage) => void;
} {
  let onMessage: ((msg: TServerMessage) => void) | null = null;
  const makeClient: TMakeSessionClient = (callbacks) => {
    onMessage = callbacks.onMessage;
    return { connect: () => {}, disconnect: () => {}, send: () => {} };
  };
  const { result } = renderHook(() => useSessionClient(makeClient));
  return { result, deliver: (msg) => act(() => onMessage?.(msg)) };
}

describe('#3186 — the GUI conversation timeline', () => {
  it('a command result becomes a command entry in the conversation, not a notice', () => {
    const { result, deliver } = setup();
    deliver({ type: 'command_result', name: 'help', message: 'line 1\nline 2', success: true });

    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: 'command', name: 'help', content: 'line 1\nline 2', tone: 'success' }),
    ]);
    expect(result.current.sessionNotices).toEqual([]);
  });

  it('a failed command result is an error-toned entry', () => {
    const { result, deliver } = setup();
    deliver({ type: 'command_result', name: 'cd', message: 'missing capability', success: false });
    expect(result.current.messages.at(-1)).toEqual(
      expect.objectContaining({ role: 'command', tone: 'error' }),
    );
  });

  it('a command result with no text (a skill that starts a turn) adds nothing', () => {
    const { result, deliver } = setup();
    deliver({ type: 'command_result', name: 'parity-demo', message: '', success: true });
    expect(result.current.messages).toEqual([]);
  });

  it('a ui_intent and its command result make ONE info entry naming what is unavailable', () => {
    const { result, deliver } = setup();
    deliver({ type: 'ui_intent', event: { intent: { type: 'show-settings' } } } as TServerMessage);
    deliver({ type: 'command_result', name: 'settings', message: 'Opening settings...', success: true });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toEqual(
      expect.objectContaining({ role: 'command', name: 'settings', tone: 'info' }),
    );
    expect(result.current.messages[0]).toHaveProperty(
      'content',
      expect.stringMatching(/settings screen is not available/i),
    );
  });

  it("a finished turn keeps its tool calls in the conversation, before the agent's reply", () => {
    const { result, deliver } = setup();
    deliver({ type: 'user_message', content: 'read it' });
    deliver({ type: 'tool_start', state: { toolName: 'Read', isRunning: true, firstArg: 'a.ts' } } as TServerMessage);
    deliver({ type: 'tool_end', state: { toolName: 'Read', isRunning: false } } as TServerMessage);
    deliver({ type: 'text_delta', delta: 'done' });
    deliver({ type: 'complete', result: { response: 'done' } } as TServerMessage);

    expect(result.current.messages.map((m) => m.role)).toEqual(['user', 'tools', 'assistant']);
    expect(result.current.messages[1]).toEqual(
      expect.objectContaining({
        tools: [expect.objectContaining({ name: 'Read', input: 'a.ts', status: 'done' })],
      }),
    );
    expect(result.current.activeTools).toEqual([]);
  });
});

describe('#3186 — commands and status for the composer', () => {
  function connectedSetup(): {
    result: { current: ReturnType<typeof useSessionClient> };
    deliver: (msg: TServerMessage) => void;
    wire: unknown[];
    connect: () => void;
  } {
    let onMessage: ((msg: TServerMessage) => void) | null = null;
    let onStatus: ((status: 'connected') => void) | null = null;
    const wire: unknown[] = [];
    const makeClient: TMakeSessionClient = (callbacks) => {
      onMessage = callbacks.onMessage;
      onStatus = callbacks.onStatusChange as (status: 'connected') => void;
      return { connect: () => {}, disconnect: () => {}, send: (m) => wire.push(m) };
    };
    const { result } = renderHook(() => useSessionClient(makeClient));
    return {
      result,
      wire,
      deliver: (msg) => act(() => onMessage?.(msg)),
      connect: () => act(() => onStatus?.('connected')),
    };
  }

  it('asks for the commands and the status once connected, and holds what arrives', () => {
    const { result, wire, deliver, connect } = connectedSetup();
    connect();
    expect(wire).toEqual(
      expect.arrayContaining([{ type: 'get-commands' }, { type: 'get-status' }]),
    );
    deliver({
      type: 'commands',
      commands: [{ name: 'help', description: 'Show commands', modelInvocable: false }],
      skills: [
        { name: 'demo', description: 'Demo', source: 'project', modelInvocable: true, userInvocable: true },
      ],
    });
    const status = {
      sessionId: 's',
      model: 'm',
      permissionMode: 'default',
      effort: 'auto',
      context: { usedPercentage: 3, usedTokens: 3, maxTokens: 100, remainingPercentage: 97 },
    } as const;
    deliver({ type: 'session_status', status });
    expect(result.current.commandCatalog?.commands.map((c) => c.name)).toEqual(['help']);
    expect(result.current.commandCatalog?.skills.map((s) => s.name)).toEqual(['demo']);
    expect(result.current.sessionStatus).toEqual(status);
  });

  it('refreshes the status after a command or a turn changes it', () => {
    const { wire, deliver } = connectedSetup();
    deliver({ type: 'command_result', name: 'mode', message: 'Mode set.', success: true });
    deliver({ type: 'complete', result: { response: '' } } as TServerMessage);
    expect(wire.filter((m) => (m as { type: string }).type === 'get-status')).toHaveLength(2);
    expect(wire).toContainEqual({ type: 'get-commands' });
  });
});
