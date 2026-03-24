/**
 * Tests for runSessionPrompt — abort behavior, tool summary extraction, partial text.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSessionPrompt } from '../useSubmitHandler.js';
import type { Session } from '@robota-sdk/agent-sdk';

// Minimal Session mock
function createMockSession(options?: {
  runResult?: string;
  runError?: Error;
  history?: Array<{ role: string; content?: string | null; toolCalls?: unknown[] }>;
}): Session {
  const history = options?.history ?? [];
  return {
    run: vi.fn().mockImplementation(() => {
      if (options?.runError) return Promise.reject(options.runError);
      return Promise.resolve(options?.runResult ?? 'response');
    }),
    getHistory: vi.fn().mockReturnValue(history),
    getContextState: vi.fn().mockReturnValue({
      usedPercentage: 10,
      usedTokens: 1000,
      maxTokens: 100000,
    }),
  } as unknown as Session;
}

describe('runSessionPrompt', () => {
  let addMessage: ReturnType<typeof vi.fn>;
  let clearStreamingText: ReturnType<typeof vi.fn>;
  let setIsThinking: ReturnType<typeof vi.fn>;
  let setContextState: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    addMessage = vi.fn();
    clearStreamingText = vi.fn();
    setIsThinking = vi.fn();
    setContextState = vi.fn();
  });

  it('shows "Cancelled." on AbortError', async () => {
    const session = createMockSession({
      runError: new DOMException('Aborted', 'AbortError'),
    });

    await runSessionPrompt(
      'test prompt',
      session,
      addMessage,
      clearStreamingText,
      setIsThinking,
      setContextState,
    );

    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'system', content: 'Cancelled.' }),
    );
  });

  it('sets isThinking to false after abort', async () => {
    const session = createMockSession({
      runError: new DOMException('Aborted', 'AbortError'),
    });

    await runSessionPrompt(
      'test prompt',
      session,
      addMessage,
      clearStreamingText,
      setIsThinking,
      setContextState,
    );

    expect(setIsThinking).toHaveBeenCalledWith(true);
    expect(setIsThinking).toHaveBeenLastCalledWith(false);
  });

  it('extracts tool summaries from history on abort', async () => {
    const history = [
      { role: 'user', content: 'test prompt' },
      {
        role: 'assistant',
        content: null,
        toolCalls: [
          { id: 'tc1', function: { name: 'Read', arguments: '{"file_path":"/tmp/test.ts"}' } },
        ],
      },
      { role: 'tool', content: 'file content', toolCallId: 'tc1', name: 'Read' },
    ];

    const session = createMockSession({
      runError: new DOMException('Aborted', 'AbortError'),
      history,
    });
    (session.getHistory as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce([])
      .mockReturnValue(history);

    await runSessionPrompt(
      'test prompt',
      session,
      addMessage,
      clearStreamingText,
      setIsThinking,
      setContextState,
    );

    const toolMessage = addMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as { role: string }).role === 'tool',
    );
    expect(toolMessage).toBeDefined();

    const cancelledIdx = addMessage.mock.calls.findIndex(
      (call: unknown[]) => (call[0] as { role: string; content: string }).content === 'Cancelled.',
    );
    const toolIdx = addMessage.mock.calls.findIndex(
      (call: unknown[]) => (call[0] as { role: string }).role === 'tool',
    );
    expect(toolIdx).toBeLessThan(cancelledIdx);
  });

  it('does not add tool message when no tools were executed before abort', async () => {
    const session = createMockSession({
      runError: new DOMException('Aborted', 'AbortError'),
      history: [{ role: 'user', content: 'test prompt' }],
    });

    await runSessionPrompt(
      'test prompt',
      session,
      addMessage,
      clearStreamingText,
      setIsThinking,
      setContextState,
    );

    const toolMessage = addMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as { role: string }).role === 'tool',
    );
    expect(toolMessage).toBeUndefined();
    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'Cancelled.' }));
  });

  it('emits an interrupted assistant message on abort', async () => {
    const session = createMockSession({
      runError: new DOMException('Aborted', 'AbortError'),
    });

    await runSessionPrompt(
      'test prompt',
      session,
      addMessage,
      clearStreamingText,
      setIsThinking,
      setContextState,
    );

    // Should emit an interrupted assistant message (content:null, state:'interrupted')
    const assistantMsg = addMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as { role: string }).role === 'assistant',
    );
    expect(assistantMsg).toBeDefined();
    expect((assistantMsg![0] as { state: string }).state).toBe('interrupted');

    // Interrupted assistant message should come before "Cancelled."
    const assistantIdx = addMessage.mock.calls.findIndex(
      (call: unknown[]) => (call[0] as { role: string }).role === 'assistant',
    );
    const cancelledIdx = addMessage.mock.calls.findIndex(
      (call: unknown[]) => (call[0] as { role: string; content: string }).content === 'Cancelled.',
    );
    expect(assistantIdx).toBeLessThan(cancelledIdx);
  });

  it('always emits an interrupted assistant message on abort regardless of streaming text', async () => {
    const session = createMockSession({
      runError: new DOMException('Aborted', 'AbortError'),
    });

    await runSessionPrompt(
      'test prompt',
      session,
      addMessage,
      clearStreamingText,
      setIsThinking,
      setContextState,
    );

    const assistantMsg = addMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as { role: string }).role === 'assistant',
    );
    // Now always emits an interrupted assistant message (state:'interrupted')
    expect(assistantMsg).toBeDefined();
    expect((assistantMsg![0] as { state: string }).state).toBe('interrupted');
    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'Cancelled.' }));
  });

  it('on normal completion, adds tool summary and assistant message', async () => {
    const history = [
      { role: 'user', content: 'test' },
      {
        role: 'assistant',
        content: null,
        toolCalls: [{ id: 'tc1', function: { name: 'Bash', arguments: '{"command":"ls"}' } }],
      },
      { role: 'tool', content: 'output', toolCallId: 'tc1', name: 'Bash' },
      { role: 'assistant', content: 'Done.' },
    ];

    const session = createMockSession({ runResult: 'Done.', history });
    (session.getHistory as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce([])
      .mockReturnValue(history);

    await runSessionPrompt(
      'test',
      session,
      addMessage,
      clearStreamingText,
      setIsThinking,
      setContextState,
    );

    const toolMessage = addMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as { role: string }).role === 'tool',
    );
    expect(toolMessage).toBeDefined();
    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', content: 'Done.' }),
    );
  });
});
