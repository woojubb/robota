import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatInput } from '../use-chat-input';

const executionMocks = vi.hoisted(() => ({
  executePrompt: vi.fn(async (prompt: string) => ({ success: true, prompt })),
  executeStreamPrompt: vi.fn(async (prompt: string) => ({ success: true, prompt })),
  clearStreamingResponse: vi.fn(),
  isExecuting: false,
}));

const loggerMocks = vi.hoisted(() => ({
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../use-robota-execution', () => ({
  useRobotaExecution: () => ({
    executePrompt: executionMocks.executePrompt,
    executeStreamPrompt: executionMocks.executeStreamPrompt,
    clearStreamingResponse: executionMocks.clearStreamingResponse,
    isExecuting: executionMocks.isExecuting,
  }),
}));

vi.mock('../../lib/web-logger', () => ({
  WebLogger: loggerMocks,
}));

describe('useChatInput', () => {
  beforeEach(() => {
    executionMocks.executePrompt.mockClear();
    executionMocks.executeStreamPrompt.mockClear();
    executionMocks.clearStreamingResponse.mockClear();
    executionMocks.isExecuting = false;
    loggerMocks.warn.mockClear();
    loggerMocks.debug.mockClear();
    loggerMocks.error.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('calculates input state and option-based validation errors', () => {
    const { result } = renderHook(() => useChatInput({ maxLength: 5 }));

    act(() => {
      result.current.setValue('hello world');
    });

    expect(result.current.inputState).toMatchObject({
      value: 'hello world',
      wordCount: 2,
      characterCount: 11,
      estimatedTokens: 3,
      isValid: false,
      errors: ['Message too long (11/5 characters)'],
    });

    act(() => {
      result.current.setValue('   ');
    });

    expect(result.current.inputState).toMatchObject({
      value: '   ',
      wordCount: 0,
      characterCount: 3,
      estimatedTokens: 0,
      isValid: false,
      errors: ['Message cannot be empty or whitespace only'],
    });
  });

  it('tracks typing state until the typing timeout elapses', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useChatInput());

    act(() => {
      result.current.setValue('hello');
    });

    expect(result.current.isTyping).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.isTyping).toBe(false);
  });

  it('supports append, clear, and cursor insertion input controls', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    const { result } = renderHook(() => useChatInput());

    act(() => {
      result.current.setValue('hello');
    });

    act(() => {
      result.current.appendToInput('world');
    });

    expect(result.current.inputState.value).toBe('hello world');

    act(() => {
      result.current.inputRef.current = textarea;
      textarea.value = result.current.inputState.value;
      textarea.setSelectionRange(6, 11);
      result.current.insertAtCursor('there');
    });

    expect(result.current.inputState.value).toBe('hello there');

    act(() => {
      result.current.clearInput();
    });

    expect(result.current.inputState.value).toBe('');
  });

  it('validates explicit text using the standalone validation contract', () => {
    const { result } = renderHook(() => useChatInput());

    expect(result.current.validateInput('')).toEqual({
      isValid: false,
      errors: ['Message cannot be empty'],
    });

    expect(result.current.validateInput('x'.repeat(4001))).toEqual({
      isValid: false,
      errors: ['Message exceeds maximum length', 'Message may exceed token limit'],
    });

    expect(result.current.validateInput('hello')).toEqual({
      isValid: true,
      errors: [],
    });
  });

  it('sends a trimmed prompt and clears the input', async () => {
    const { result } = renderHook(() => useChatInput());

    act(() => {
      result.current.setValue('  run agent  ');
    });

    let sendResult: unknown;
    await act(async () => {
      sendResult = await result.current.sendMessage();
    });

    expect(executionMocks.executePrompt).toHaveBeenCalledWith('run agent');
    expect(sendResult).toEqual({ success: true, prompt: 'run agent' });
    expect(result.current.inputState.value).toBe('');
  });

  it('blocks sending while execution is already active', async () => {
    executionMocks.isExecuting = true;
    const { result } = renderHook(() => useChatInput());

    act(() => {
      result.current.setValue('busy');
    });

    let sendResult: unknown = 'not-called';
    await act(async () => {
      sendResult = await result.current.sendMessage();
    });

    expect(sendResult).toBeUndefined();
    expect(executionMocks.executePrompt).not.toHaveBeenCalled();
    expect(loggerMocks.warn).toHaveBeenCalledWith('sendMessage blocked', {
      canSend: false,
      hasMessage: true,
    });
  });

  it('clears streaming state before sending a streaming prompt', async () => {
    const { result } = renderHook(() => useChatInput());

    act(() => {
      result.current.setValue('stream this');
    });

    await act(async () => {
      await result.current.sendStreamingMessage();
    });

    expect(executionMocks.clearStreamingResponse).toHaveBeenCalledTimes(1);
    expect(executionMocks.executeStreamPrompt).toHaveBeenCalledWith('stream this');
    expect(result.current.inputState.value).toBe('');
  });

  it('restores input when prompt execution fails', async () => {
    executionMocks.executePrompt.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useChatInput());

    act(() => {
      result.current.setValue('restore me');
    });

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.sendMessage();
      } catch (error) {
        thrown = error;
      }
    });

    expect(thrown).toBeInstanceOf(Error);
    expect(result.current.inputState.value).toBe('restore me');
    expect(loggerMocks.error).toHaveBeenCalledWith('Failed to send message', {
      error: 'boom',
    });
  });

  it('retries the last successfully submitted user input', async () => {
    const { result } = renderHook(() => useChatInput());

    act(() => {
      result.current.setValue('retry me');
    });

    await act(async () => {
      await result.current.sendMessage();
      await result.current.retryLastMessage();
    });

    expect(executionMocks.executePrompt).toHaveBeenNthCalledWith(1, 'retry me');
    expect(executionMocks.executePrompt).toHaveBeenNthCalledWith(2, 'retry me');
  });

  it('keeps current chat history placeholders empty', () => {
    const { result } = renderHook(() => useChatInput());

    expect(result.current.chatHistory).toEqual([]);
    expect(result.current.exportChatHistory()).toBe('');
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.streamingResponse).toBe('');
    expect(result.current.isReceivingStream).toBe(false);
  });
});
