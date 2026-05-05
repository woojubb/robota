'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRobotaExecution } from '../use-robota-execution';
import { WebLogger } from '../../lib/web-logger';
import { TYPING_TIMEOUT_MS } from './constants';
import { calculateChatInputState } from './input-state';
import { useInputFocus } from './use-input-focus';
import { validateChatInputText } from './validation';
import type { IChatInputHookReturn, IChatInputOptions, IChatMessage } from './types';

export function useChatInput(options: IChatInputOptions = {}): IChatInputHookReturn {
  const { maxLength = 10000, enableValidation = true } = options;
  const { executePrompt, executeStreamPrompt, isExecuting, clearStreamingResponse } =
    useRobotaExecution();

  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [chatHistory] = useState<IChatMessage[]>([]);

  const userMessageHistory = useMemo(() => {
    return chatHistory.filter((msg) => msg.type === 'user').map((msg) => msg.content);
  }, [chatHistory]);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastUserInputRef = useRef<string>('');

  const inputState = useMemo(() => {
    return calculateChatInputState({
      value: inputValue,
      enableValidation,
      maxLength,
    });
  }, [enableValidation, inputValue, maxLength]);

  const canSend = !isExecuting && inputState.isValid;

  const setValue = useCallback((value: string) => {
    setInputValue(value);
    setIsTyping(value.length > 0);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
    }, TYPING_TIMEOUT_MS);

    setShowSuggestions(false);
  }, []);

  const clearInput = useCallback(() => {
    setInputValue('');
    setHistoryIndex(-1);
    setShowSuggestions(false);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const appendToInput = useCallback(
    (text: string) => {
      setValue(inputValue + (inputValue ? ' ' : '') + text);
    },
    [inputValue, setValue],
  );

  const insertAtCursor = useCallback(
    (text: string) => {
      if (!inputRef.current) return;

      const start = inputRef.current.selectionStart || 0;
      const end = inputRef.current.selectionEnd || 0;
      const newValue = inputValue.substring(0, start) + text + inputValue.substring(end);
      setValue(newValue);

      setTimeout(() => {
        if (inputRef.current) {
          const newPosition = start + text.length;
          inputRef.current.setSelectionRange(newPosition, newPosition);
        }
      }, 0);
    },
    [inputValue, setValue],
  );

  const sendMessage = useCallback(
    async (message?: string) => {
      const messageToSend = message || inputValue.trim();

      if (!canSend || !messageToSend) {
        WebLogger.warn('sendMessage blocked', { canSend, hasMessage: !!messageToSend });
        return undefined;
      }

      try {
        lastUserInputRef.current = messageToSend;
        clearInput();
        setHistoryIndex(-1);
        WebLogger.debug('Sending message', { messageLength: messageToSend.length });
        const result = await executePrompt(messageToSend);
        WebLogger.debug('sendMessage result', { success: !!result?.success });
        return result;
      } catch (error) {
        WebLogger.error('Failed to send message', {
          error: error instanceof Error ? error.message : String(error),
        });
        setValue(messageToSend);
        throw error;
      }
    },
    [canSend, clearInput, executePrompt, inputValue, setValue],
  );

  const sendStreamingMessage = useCallback(
    async (message?: string) => {
      const messageToSend = message || inputValue.trim();

      if (!canSend || !messageToSend) {
        WebLogger.warn('sendStreamingMessage blocked', { canSend, hasMessage: !!messageToSend });
        return undefined;
      }

      try {
        lastUserInputRef.current = messageToSend;
        clearInput();
        setHistoryIndex(-1);
        clearStreamingResponse();
        WebLogger.debug('Sending streaming message', { messageLength: messageToSend.length });
        const result = await executeStreamPrompt(messageToSend);
        WebLogger.debug('sendStreamingMessage result', { success: !!result?.success });
        return result;
      } catch (error) {
        WebLogger.error('Failed to send streaming message', {
          error: error instanceof Error ? error.message : String(error),
        });
        setValue(messageToSend);
        throw error;
      }
    },
    [canSend, clearInput, clearStreamingResponse, executeStreamPrompt, inputValue, setValue],
  );

  const retryLastMessage = useCallback(async () => {
    if (lastUserInputRef.current) {
      try {
        await executePrompt(lastUserInputRef.current);
      } catch (error) {
        WebLogger.error('Failed to retry message', {
          error: error instanceof Error ? error.message : String(error),
        });
        setValue(lastUserInputRef.current);
      }
    }
  }, [executePrompt, setValue]);

  const navigateHistory = useCallback(
    (direction: 'up' | 'down') => {
      if (userMessageHistory.length === 0) return;

      if (direction === 'up') {
        const newIndex = Math.min(historyIndex + 1, userMessageHistory.length - 1);
        setHistoryIndex(newIndex);
        setValue(userMessageHistory[newIndex] || '');
      } else if (historyIndex <= 0) {
        setHistoryIndex(-1);
        setValue('');
      } else {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setValue(userMessageHistory[newIndex] || '');
      }
    },
    [historyIndex, setValue, userMessageHistory],
  );

  const insertTemplate = useCallback(
    (template: string) => {
      insertAtCursor(template);
    },
    [insertAtCursor],
  );

  const selectSuggestion = useCallback(
    (suggestion: string) => {
      setValue(suggestion);
      setShowSuggestions(false);
      if (inputRef.current) {
        inputRef.current.focus();
      }
    },
    [setValue],
  );

  const clearChatHistory = useCallback(() => undefined, []);
  const exportChatHistory = useCallback((): string => {
    return chatHistory
      .map(
        (msg) =>
          `[${msg.timestamp.toLocaleTimeString()}] ${msg.type.toUpperCase()}: ${msg.content}`,
      )
      .join('\n');
  }, [chatHistory]);

  const focusInput = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const stopStreaming = useCallback(() => {
    clearStreamingResponse();
  }, [clearStreamingResponse]);

  useInputFocus({ inputRef, setIsInputFocused });

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  return {
    inputState,
    isTyping,
    isSending: isExecuting,
    canSend,
    setValue,
    clearInput,
    appendToInput,
    insertAtCursor,
    sendMessage,
    sendStreamingMessage,
    retryLastMessage,
    chatHistory,
    clearChatHistory,
    exportChatHistory,
    navigateHistory,
    insertTemplate,
    suggestions: [],
    showSuggestions,
    selectSuggestion,
    validateInput: validateChatInputText,
    inputRef,
    focusInput,
    isInputFocused,
    streamingResponse: '',
    isReceivingStream: false,
    stopStreaming,
  };
}
