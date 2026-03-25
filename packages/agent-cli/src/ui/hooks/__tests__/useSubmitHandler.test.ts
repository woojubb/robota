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

  it('displays interrupted assistant message from history on abort', async () => {
    const interruptedHistory = [
      { role: 'user', content: 'test', id: '1', state: 'complete', timestamp: new Date() },
      {
        role: 'assistant',
        content: 'Partial text before abort',
        id: '2',
        state: 'interrupted',
        timestamp: new Date(),
      },
    ];
    const session = createMockSession({
      runError: new DOMException('Aborted', 'AbortError'),
      history: interruptedHistory,
    });
    (session.getHistory as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce([])
      .mockReturnValue(interruptedHistory);

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
    expect(assistantMsg).toBeDefined();
    expect((assistantMsg![0] as { content: string }).content).toBe('Partial text before abort');
    expect((assistantMsg![0] as { state: string }).state).toBe('interrupted');

    // Interrupted message comes before "Cancelled."
    const assistantIdx = addMessage.mock.calls.findIndex(
      (call: unknown[]) => (call[0] as { role: string }).role === 'assistant',
    );
    const cancelledIdx = addMessage.mock.calls.findIndex(
      (call: unknown[]) => (call[0] as { role: string; content: string }).content === 'Cancelled.',
    );
    expect(assistantIdx).toBeLessThan(cancelledIdx);
  });

  it('displays assistant message on abort during tool execution (state: complete)', async () => {
    // Scenario: provider returned normally (not aborted), tools started executing,
    // user pressed ESC during tool execution. The assistant message has state: 'complete'
    // because signal wasn't aborted when commitAssistant was called.
    const historyWithCompleteAssistant = [
      { role: 'user', content: 'run audit', id: '1', state: 'complete', timestamp: new Date() },
      {
        role: 'assistant',
        content: 'I will read these files to audit:',
        id: '2',
        state: 'complete', // NOT interrupted — abort happened during tool execution
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'Read', arguments: '{"file_path":"/tmp/test.ts"}' },
          },
        ],
      },
      {
        role: 'tool',
        content: 'file content',
        id: '3',
        state: 'complete',
        timestamp: new Date(),
        toolCallId: 'tc1',
        name: 'Read',
      },
    ];
    const session = createMockSession({
      runError: new DOMException('Aborted', 'AbortError'),
      history: historyWithCompleteAssistant,
    });
    (session.getHistory as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce([]) // historyBefore = 0
      .mockReturnValue(historyWithCompleteAssistant);

    await runSessionPrompt(
      'run audit',
      session,
      addMessage,
      clearStreamingText,
      setIsThinking,
      setContextState,
    );

    // Should find and display the assistant message even though state is 'complete'
    const assistantMsg = addMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as { role: string }).role === 'assistant',
    );
    expect(assistantMsg).toBeDefined();
    expect((assistantMsg![0] as { content: string }).content).toBe(
      'I will read these files to audit:',
    );
  });

  it('merges consecutive assistant messages from multi-round execution on abort', async () => {
    const multiRoundHistory = [
      { role: 'user', content: 'run audit', id: '1', state: 'complete', timestamp: new Date() },
      {
        role: 'assistant',
        content: 'I will read the reference files first.',
        id: '2',
        state: 'complete',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'Read', arguments: '{"file_path":"/tmp/a"}' },
          },
        ],
      },
      {
        role: 'tool',
        content: 'file a content',
        id: '3',
        state: 'complete',
        timestamp: new Date(),
        toolCallId: 'tc1',
        name: 'Read',
      },
      {
        role: 'assistant',
        content: 'Now checking project files...',
        id: '4',
        state: 'interrupted',
        timestamp: new Date(),
      },
    ];
    const session = createMockSession({
      runError: new DOMException('Aborted', 'AbortError'),
      history: multiRoundHistory,
    });
    (session.getHistory as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce([])
      .mockReturnValue(multiRoundHistory);

    await runSessionPrompt(
      'run audit',
      session,
      addMessage,
      clearStreamingText,
      setIsThinking,
      setContextState,
    );

    // Should merge into ONE assistant message with combined content
    const assistantMsgs = addMessage.mock.calls.filter(
      (call: unknown[]) => (call[0] as { role: string }).role === 'assistant',
    );
    expect(assistantMsgs).toHaveLength(1);
    const merged = assistantMsgs[0][0] as { content: string; state: string };
    expect(merged.content).toContain('I will read the reference files first.');
    expect(merged.content).toContain('Now checking project files...');
    // Last assistant was interrupted → merged message should be interrupted
    expect(merged.state).toBe('interrupted');
  });

  it('does not add assistant message on abort when history has no assistant message', async () => {
    const session = createMockSession({
      runError: new DOMException('Aborted', 'AbortError'),
      history: [
        { role: 'user', content: 'test', id: '1', state: 'complete', timestamp: new Date() },
      ],
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
    expect(assistantMsg).toBeUndefined();
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
