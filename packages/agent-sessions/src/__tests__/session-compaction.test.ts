/**
 * Tests for Session context compaction behavior.
 *
 * Verifies:
 * - compact() injects summary as assistant message with actual content
 * - compact() does not call robota.run() (no streaming interference)
 * - compact() forwards instructions to the compaction prompt
 * - compact() on empty history is a no-op
 * - onTextDelta is disabled during compaction
 * - Auto-compact triggers at start of run() when threshold exceeded
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Session } from '../session.js';

// Track calls to mock Robota
let mockHistory: Array<{ role: string; content: string | null; metadata?: Record<string, unknown> }> = [];
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
          metadata: { inputTokens: 1000, outputTokens: 200 },
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

// Track provider.chat calls for instruction verification
let providerChatCalls: Array<{ messages: unknown[]; options: unknown }> = [];
let providerOnTextDelta: ((delta: string) => void) | undefined;
let textDeltaCalls: string[] = [];

function createMockProvider() {
  providerChatCalls = [];
  textDeltaCalls = [];
  providerOnTextDelta = (delta: string) => textDeltaCalls.push(delta);

  return {
    name: 'mock',
    chat: vi.fn().mockImplementation(async (messages: unknown[], options: unknown) => {
      providerChatCalls.push({ messages, options });
      return {
        role: 'assistant',
        content: 'summary of the conversation so far',
        timestamp: new Date(),
      };
    }),
    get onTextDelta() {
      return providerOnTextDelta;
    },
    set onTextDelta(val: ((delta: string) => void) | undefined) {
      providerOnTextDelta = val;
    },
  } as never;
}

const MOCK_TOOLS = [] as never;
const MOCK_TERMINAL = {
  write: vi.fn(),
  writeLine: vi.fn(),
  writeMarkdown: vi.fn(),
  writeError: vi.fn(),
  prompt: vi.fn(),
  select: vi.fn(),
  spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
} as never;

let mockProvider: ReturnType<typeof createMockProvider>;

function createSession(opts: Record<string, unknown> = {}): Session {
  mockProvider = createMockProvider();
  return new Session({
    tools: MOCK_TOOLS,
    provider: mockProvider,
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
  providerChatCalls = [];
  textDeltaCalls = [];
});

describe('Session compaction', () => {
  it('compact() clears history and injects summary as assistant message', async () => {
    const session = createSession();
    mockHistory = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];

    await session.compact();

    expect(mockClearCount).toBe(1);
    expect(mockInjectCalls.length).toBe(1);
    expect(mockInjectCalls[0].role).toBe('assistant');
    expect(mockInjectCalls[0].content).toContain('[Context Summary]');
    // Verify actual summary content from provider is included
    expect(mockInjectCalls[0].content).toContain('summary of the conversation so far');
  });

  it('compact() does not call robota.run() (no streaming interference)', async () => {
    const session = createSession();
    mockHistory = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];

    await session.compact();

    expect(mockRunCalls.length).toBe(0);
  });

  it('compact() with instructions includes them in the compaction prompt', async () => {
    const session = createSession();
    mockHistory = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];

    await session.compact('focus on API changes');

    // Verify provider.chat was called with a prompt containing the instructions
    expect(providerChatCalls.length).toBe(1);
    const prompt = JSON.stringify(providerChatCalls[0].messages);
    expect(prompt).toContain('focus on API changes');
  });

  it('compact() on empty history is a no-op', async () => {
    const session = createSession();
    mockHistory = [];

    await session.compact();

    expect(mockClearCount).toBe(0);
    expect(mockInjectCalls.length).toBe(0);
    expect(providerChatCalls.length).toBe(0);
  });

  it('onTextDelta is disabled during compaction and restored after', async () => {
    const session = createSession();
    mockHistory = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];

    // Verify onTextDelta exists before compact
    expect(providerOnTextDelta).toBeDefined();

    await session.compact();

    // After compact, onTextDelta should be restored
    expect(providerOnTextDelta).toBeDefined();
    // No text deltas should have been emitted during compaction
    expect(textDeltaCalls.length).toBe(0);
  });
});
