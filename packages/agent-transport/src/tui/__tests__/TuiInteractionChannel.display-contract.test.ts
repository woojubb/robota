/**
 * Display-contract tests for TuiInteractionChannel.
 *
 * Verifies user-visible state: which entries appear in stateManager.history,
 * with which roles, and in which order.
 *
 * These are deliberately separate from lifecycle.test.ts:
 *   lifecycle  → event routing / onChange propagation (mechanism layer)
 *   this file  → what the user sees on screen (display contract layer)
 *
 * Design principles:
 *   - user_message assertions do NOT require getFullHistory injection
 *   - every history assertion checks entry.type (= role) explicitly
 *   - timing: user message visible BEFORE complete fires
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@robota-sdk/agent-framework', async () => {
  const actual = await vi.importActual<typeof import('@robota-sdk/agent-framework')>(
    '@robota-sdk/agent-framework',
  );
  return {
    ...actual,
    InteractiveSession: vi.fn().mockImplementation(() => {
      const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
      return {
        getFullHistory: vi.fn().mockReturnValue([]),
        setName: vi.fn(),
        getName: vi.fn().mockReturnValue(undefined),
        getPermissionMode: vi.fn().mockReturnValue('default'),
        isInitialized: false,
        on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
          if (!handlers.has(event)) handlers.set(event, []);
          handlers.get(event)!.push(handler);
        }),
        off: vi.fn(),
        emit: (event: string, ...args: unknown[]) => {
          (handlers.get(event) ?? []).forEach((h) => h(...args));
        },
        submit: vi.fn().mockResolvedValue(undefined),
        executeCommand: vi.fn().mockResolvedValue(null),
        getPendingPrompt: vi.fn().mockReturnValue(null),
        abort: vi.fn(),
        cancelQueue: vi.fn(),
        getContextState: vi.fn().mockReturnValue({
          usedPercentage: 0,
          usedTokens: 0,
          maxTokens: 100_000,
        }),
        getExecutionWorkspaceSnapshot: vi.fn().mockReturnValue({ entries: [] }),
        shutdown: vi.fn().mockResolvedValue(undefined),
        sendAgentJob: vi.fn().mockResolvedValue(undefined),
        readExecutionWorkspaceDetail: vi.fn().mockResolvedValue({}),
      };
    }),
    CommandRegistry: vi.fn().mockImplementation(() => ({
      addModule: vi.fn(),
    })),
  };
});

import {
  createAssistantMessage,
  createSystemMessage,
  createUserMessage,
  messageToHistoryEntry,
} from '@robota-sdk/agent-core';
import { TuiInteractionChannel } from '../TuiInteractionChannel.js';

import type { IAIProvider, IHistoryEntry } from '@robota-sdk/agent-core';
import type { IExecutionResult } from '@robota-sdk/agent-framework';

// ── Helpers ───────────────────────────────────────────────────────────────────

type MockSession = {
  getFullHistory: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
};

function getMockSession(channel: TuiInteractionChannel): MockSession {
  return (channel as unknown as { interactiveSession: MockSession }).interactiveSession;
}

function emitSessionEvent(channel: TuiInteractionChannel, event: string, ...args: unknown[]): void {
  getMockSession(channel).emit(event, ...args);
}

function makeChannel(): TuiInteractionChannel {
  return new TuiInteractionChannel({
    cwd: '/tmp/test',
    provider: {} as IAIProvider,
  });
}

function makeResult(overrides?: Partial<IExecutionResult>): IExecutionResult {
  return {
    contextState: { usedPercentage: 5, usedTokens: 500, maxTokens: 100_000 },
    response: 'done',
    ...overrides,
  } as unknown as IExecutionResult;
}

const MOCK_TOOL_RUNNING = {
  toolName: 'bash',
  isRunning: true,
  input: '{}',
  startTime: Date.now(),
};

const MOCK_TOOL_DONE = {
  toolName: 'bash',
  isRunning: false,
  input: '{}',
  startTime: Date.now(),
};

function entryRole(entry: IHistoryEntry): string {
  return entry.type;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Group D: display contract (what the user sees) ────────────────────────────

describe('Group D — display contract: history entries and active tools', () => {
  it('D1 (CLI-B05): user_message event immediately adds role=user entry before complete', async () => {
    const channel = makeChannel();
    await channel.start();

    // user message fires BEFORE complete — must be in history immediately
    emitSessionEvent(channel, 'user_message', 'hello');

    expect(channel.stateManager.history).toHaveLength(1);
    expect(entryRole(channel.stateManager.history[0])).toBe('user');
    expect((channel.stateManager.history[0].data as { content: string }).content).toBe('hello');

    await channel.stop();
  });

  it('D2: complete syncs assistant entry into history', async () => {
    const channel = makeChannel();
    const mockSession = getMockSession(channel);
    const assistantEntry = messageToHistoryEntry(createAssistantMessage('Hi!'));
    mockSession.getFullHistory.mockReturnValue([assistantEntry]);
    await channel.start();

    emitSessionEvent(channel, 'complete', makeResult());

    const roles = channel.stateManager.history.map(entryRole);
    expect(roles).toContain('assistant');
    await channel.stop();
  });

  it('D3 (CLI-B06): error event syncs error entry into history — no silent failure', async () => {
    const channel = makeChannel();
    const mockSession = getMockSession(channel);
    const userEntry = messageToHistoryEntry(createUserMessage('hello'));
    const errorEntry = messageToHistoryEntry(createSystemMessage('Error: network failure'));
    mockSession.getFullHistory.mockReturnValue([userEntry, errorEntry]);
    await channel.start();

    emitSessionEvent(channel, 'user_message', 'hello');
    emitSessionEvent(channel, 'error');

    // error entry from getFullHistory must be visible
    const roles = channel.stateManager.history.map(entryRole);
    expect(roles).toContain('system');
    await channel.stop();
  });

  it('D4 (CLI-B07): tool_end marks tool isRunning=false; complete clears all (no stale spinner after complete)', async () => {
    const channel = makeChannel();
    await channel.start();

    emitSessionEvent(channel, 'tool_start', MOCK_TOOL_RUNNING);
    expect(channel.stateManager.activeTools).toHaveLength(1);

    // After tool_end: tool stays in activeTools with isRunning:false (shows "ran" status during streaming)
    emitSessionEvent(channel, 'tool_end', MOCK_TOOL_DONE);
    expect(channel.stateManager.activeTools).toHaveLength(1);
    expect(channel.stateManager.activeTools[0]!.isRunning).toBe(false);

    // After complete: all tools cleared — StreamingIndicator must be gone
    emitSessionEvent(channel, 'complete', makeResult());
    expect(channel.stateManager.activeTools).toHaveLength(0);

    await channel.stop();
  });

  it('D5 (CLI-B08): thinking(false) clears activeTools even without complete', async () => {
    const channel = makeChannel();
    await channel.start();

    emitSessionEvent(channel, 'thinking', true);
    emitSessionEvent(channel, 'tool_start', MOCK_TOOL_RUNNING);
    expect(channel.stateManager.activeTools).toHaveLength(1);

    // abort path: thinking(false) without complete
    emitSessionEvent(channel, 'thinking', false);
    expect(channel.stateManager.activeTools).toHaveLength(0);

    await channel.stop();
  });

  it('D6: full turn — user entry appears first, assistant entry follows after complete', async () => {
    const channel = makeChannel();
    const mockSession = getMockSession(channel);
    const userEntry = messageToHistoryEntry(createUserMessage('hello'));
    const assistantEntry = messageToHistoryEntry(createAssistantMessage('world'));
    // session history after complete includes both
    mockSession.getFullHistory.mockReturnValue([userEntry, assistantEntry]);
    await channel.start();

    // 1. user message fires — visible immediately
    emitSessionEvent(channel, 'user_message', 'hello');
    expect(entryRole(channel.stateManager.history[0])).toBe('user');

    // 2. streaming
    emitSessionEvent(channel, 'text_delta', 'world');
    expect(channel.stateManager.streamingText).toBe('world');

    // 3. complete — syncHistory replaces with authoritative session history
    emitSessionEvent(channel, 'complete', makeResult());
    expect(channel.stateManager.streamingText).toBe('');

    const roles = channel.stateManager.history.map(entryRole);
    expect(roles[0]).toBe('user');
    expect(roles[1]).toBe('assistant');

    await channel.stop();
  });
});
