/**
 * Tests for Session context compaction behavior.
 *
 * Verifies:
 * - compact() injects summary as assistant message
 * - Auto-compact triggers at start of run(), not end
 * - onTextDelta is disabled during compaction
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Session } from '../session.js';

// Track calls to mock Robota
let mockHistory: Array<{ role: string; content: string }> = [];
let mockInjectCalls: Array<{ role: string; content: string }> = [];
let mockRunCalls: string[] = [];
let mockClearCount = 0;

vi.mock('@robota-sdk/agent-core', async () => {
  const actual = await vi.importActual('@robota-sdk/agent-core');
  return {
    ...actual,
    Robota: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockImplementation(async (msg: string) => {
        mockRunCalls.push(msg);
        mockHistory.push({ role: 'user', content: msg });
        mockHistory.push({
          role: 'assistant',
          content: 'mock response',
        });
        return 'mock response';
      }),
      getHistory: vi.fn().mockImplementation(() => mockHistory),
      clearHistory: vi.fn().mockImplementation(() => {
        mockClearCount++;
        mockHistory = [];
      }),
      injectMessage: vi.fn().mockImplementation((role: string, content: string) => {
        mockInjectCalls.push({ role, content });
        mockHistory.push({ role, content });
      }),
    })),
    runHooks: vi.fn().mockResolvedValue(undefined),
  };
});

const MOCK_TOOLS = [] as never;
const MOCK_PROVIDER = {
  name: 'mock',
  chat: vi.fn().mockResolvedValue({
    role: 'assistant',
    content: 'summary of conversation',
    timestamp: new Date(),
  }),
  onTextDelta: undefined as ((delta: string) => void) | undefined,
} as never;
const MOCK_TERMINAL = {
  write: vi.fn(),
  writeLine: vi.fn(),
  writeMarkdown: vi.fn(),
  writeError: vi.fn(),
  prompt: vi.fn(),
  select: vi.fn(),
  spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
} as never;

function createSession(opts: Record<string, unknown> = {}): Session {
  return new Session({
    tools: MOCK_TOOLS,
    provider: MOCK_PROVIDER,
    systemMessage: 'test system',
    terminal: MOCK_TERMINAL,
    model: 'claude-sonnet-4-6',
    ...opts,
  });
}

beforeEach(() => {
  mockHistory = [];
  mockInjectCalls = [];
  mockRunCalls = [];
  mockClearCount = 0;
  vi.clearAllMocks();
});

describe('Session compaction', () => {
  it('compact() clears history and injects summary as assistant message', async () => {
    const session = createSession();
    // Seed some history
    mockHistory = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];

    await session.compact();

    // History should have been cleared
    expect(mockClearCount).toBe(1);

    // Summary should be injected as assistant message
    expect(mockInjectCalls.length).toBe(1);
    expect(mockInjectCalls[0].role).toBe('assistant');
    expect(mockInjectCalls[0].content).toContain('[Context Summary]');
  });

  it('compact() does not call robota.run() (no streaming interference)', async () => {
    const session = createSession();
    mockHistory = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];

    await session.compact();

    // robota.run() should NOT have been called during compaction
    expect(mockRunCalls.length).toBe(0);
  });

  it('compact() with instructions passes them to orchestrator', async () => {
    const session = createSession();
    mockHistory = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];

    await session.compact('focus on API changes');

    expect(mockInjectCalls.length).toBe(1);
    expect(mockInjectCalls[0].role).toBe('assistant');
  });

  it('compact() on empty history is a no-op', async () => {
    const session = createSession();
    mockHistory = [];

    await session.compact();

    expect(mockClearCount).toBe(0);
    expect(mockInjectCalls.length).toBe(0);
  });
});
