'use client';

const TOKEN_ESTIMATE_MULTIPLIER = 1.3;
const TYPING_TIMEOUT_MS = 1000;
const MAX_MESSAGE_LENGTH = 4000;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const MAX_TOKEN_WARNING = 1000;

/**
 * useChatInput - Real-time Chat Management Hook
 * 
 * Specialized hook for managing chat input, message sending, and real-time
 * chat interactions in the Playground interface.
 * 
 * This hook handles:
 * - Chat input state and validation
 * - Message composition and formatting
 * - Real-time message sending with feedback
 * - Chat history management and navigation
 * - Input suggestions and auto-completion
 * - Keyboard shortcuts and accessibility
 */

import { useState, useCallback, useRef, useEffect, useMemo, type RefObject } from 'react';
import { useRobotaExecution } from './use-robota-execution';
import type { IUseBlockTrackingResult } from './use-block-tracking';
import { WebLogger } from '../lib/web-logger';
import type { TUniversalValue } from '@robota-sdk/agents';
import type { IPlaygroundExecutorResult } from '../lib/playground/robota-executor';

export interface IChatMessage {
    id: string;
    type: 'user' | 'assistant' | 'system' | 'error';
    content: string;
    timestamp: Date;
    isStreaming?: boolean;
    metadata?: Record<string, TUniversalValue>;
}

export interface IChatInputState {
    value: string;
    isValid: boolean;
    errors: string[];
    wordCount: number;
    characterCount: number;
    estimatedTokens: number;
}

export interface IChatInputOptions {
    /** Block tracking integration for automatic block creation */
    blockTracking?: IUseBlockTrackingResult;

    /** Maximum input length */
    maxLength?: number;

    /** Enable input validation */
    enableValidation?: boolean;

    /** Placeholder text */
    placeholder?: string;
}

export interface IChatInputHookReturn {
    // Input State
    inputState: IChatInputState;
    isTyping: boolean;
    isSending: boolean;
    canSend: boolean;

    // Input Control
    setValue: (value: string) => void;
    clearInput: () => void;
    appendToInput: (text: string) => void;
    insertAtCursor: (text: string) => void;

    // Message Management
    sendMessage: (message?: string) => Promise<IPlaygroundExecutorResult | undefined>;
    sendStreamingMessage: (message?: string) => Promise<IPlaygroundExecutorResult | undefined>;
    retryLastMessage: () => Promise<void>;

    // Chat History
    chatHistory: IChatMessage[];
    clearChatHistory: () => void;
    exportChatHistory: () => string;

    // Navigation and Shortcuts
    navigateHistory: (direction: 'up' | 'down') => void;
    insertTemplate: (template: string) => void;

    // Suggestions and Auto-completion
    suggestions: string[];
    showSuggestions: boolean;
    selectSuggestion: (suggestion: string) => void;

    // Input Validation
    validateInput: (text: string) => { isValid: boolean; errors: string[] };

    // Accessibility and UX
    inputRef: RefObject<HTMLTextAreaElement | null>;
    focusInput: () => void;
    isInputFocused: boolean;

    // Streaming Response
    streamingResponse: string;
    isReceivingStream: boolean;
    stopStreaming: () => void;
}

export function useChatInput(options: IChatInputOptions = {}): IChatInputHookReturn {
    const {
        maxLength = 10000,
        enableValidation = true } = options;

    const {
        executePrompt,
        executeStreamPrompt,
        isExecuting,
        clearStreamingResponse
    } = useRobotaExecution();

    // Input state
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);

    // Chat history (simplified for now)
    const [chatHistory, setChatHistory] = useState<IChatMessage[]>([]);
    const userMessageHistory = useMemo(() => {
        return chatHistory.filter(msg => msg.type === 'user').map(msg => msg.content);
    }, [chatHistory]);

    // Refs
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastUserInputRef = useRef<string>('');

    // Input validation and state calculation
    const inputState = useMemo<IChatInputState>(() => {
        const trimmed = inputValue.trim();
        const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
        const characterCount = inputValue.length;

        // Basic validation
        const errors: string[] = [];
        if (enableValidation) {
            if (characterCount > maxLength) {
                errors.push(`Message too long (${characterCount}/${maxLength} characters)`);
            }
            if (trimmed.length === 0 && characterCount > 0) {
                errors.push('Message cannot be empty or whitespace only');
            }
        }

        return {
            value: inputValue,
            isValid: errors.length === 0 && trimmed.length > 0,
            errors,
            wordCount,
            characterCount,
            estimatedTokens: Math.ceil(wordCount * TOKEN_ESTIMATE_MULTIPLIER) // Rough estimate
        };
    }, [inputValue, enableValidation, maxLength]);

    // Derived state
    const canSend = !isExecuting && inputState.isValid; // Can send when NOT executing and input is valid

    // Input control functions
    const setValue = useCallback((value: string) => {
        setInputValue(value);
        setIsTyping(value.length > 0);

        // Reset typing timeout
        if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
        }

        typingTimeoutRef.current = setTimeout(() => {
            setIsTyping(false);
        }, TYPING_TIMEOUT_MS);

        // Show suggestions if appropriate (temporarily disabled)
        setShowSuggestions(false); // Simplified for now
    }, []); // Removed suggestions.length dependency

    const clearInput = useCallback(() => {
        setInputValue('');
        setHistoryIndex(-1);
        setShowSuggestions(false);
        if (inputRef.current) {
            inputRef.current.focus();
        }
    }, []);

    const appendToInput = useCallback((text: string) => {
        const newValue = inputValue + (inputValue ? ' ' : '') + text;
        setValue(newValue);
    }, [inputValue, setValue]);

    const insertAtCursor = useCallback((text: string) => {
        if (!inputRef.current) return;

        const start = inputRef.current.selectionStart || 0;
        const end = inputRef.current.selectionEnd || 0;
        const beforeCursor = inputValue.substring(0, start);
        const afterCursor = inputValue.substring(end);

        const newValue = beforeCursor + text + afterCursor;
        setValue(newValue);

        // Update cursor position after insertion
        setTimeout(() => {
            if (inputRef.current) {
                const newPosition = start + text.length;
                inputRef.current.setSelectionRange(newPosition, newPosition);
            }
        }, 0);
    }, [inputValue, setValue]);

    // Message sending
    const sendMessage = useCallback(async (message?: string): Promise<IPlaygroundExecutorResult | undefined> => {
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
            WebLogger.error('Failed to send message', { error: error instanceof Error ? error.message : String(error) });
            // Restore input on error
            setValue(messageToSend);
            throw error; // Re-throw to let parent handle
        }
    }, [inputValue, canSend, clearInput, executePrompt, setValue]);

    const sendStreamingMessage = useCallback(async (message?: string): Promise<IPlaygroundExecutorResult | undefined> => {
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
            WebLogger.error('Failed to send streaming message', { error: error instanceof Error ? error.message : String(error) });
            setValue(messageToSend);
            throw error; // Re-throw to let parent handle
        }
    }, [inputValue, canSend, clearInput, executeStreamPrompt, clearStreamingResponse, setValue]);

    const retryLastMessage = useCallback(async () => {
        if (lastUserInputRef.current) {
            try {
                // Assuming retryLastExecution is part of useRobotaExecution or passed as a prop
                // For now, we'll just re-execute the last prompt
                await executePrompt(lastUserInputRef.current);
            } catch (error) {
                WebLogger.error('Failed to retry message', { error: error instanceof Error ? error.message : String(error) });
                setValue(lastUserInputRef.current);
            }
        }
    }, [executePrompt, setValue]);

    // Navigation and shortcuts
    const navigateHistory = useCallback((direction: 'up' | 'down') => {
        if (userMessageHistory.length === 0) return;

        if (direction === 'up') {
            const newIndex = Math.min(historyIndex + 1, userMessageHistory.length - 1);
            setHistoryIndex(newIndex);
            setValue(userMessageHistory[newIndex] || '');
        } else {
            if (historyIndex <= 0) {
                setHistoryIndex(-1);
                setValue('');
            } else {
                const newIndex = historyIndex - 1;
                setHistoryIndex(newIndex);
                setValue(userMessageHistory[newIndex] || '');
            }
        }
    }, [historyIndex, userMessageHistory, setValue]);

    const insertTemplate = useCallback((template: string) => {
        insertAtCursor(template);
    }, [insertAtCursor]);

    // Suggestions
    const selectSuggestion = useCallback((suggestion: string) => {
        setValue(suggestion);
        setShowSuggestions(false);
        if (inputRef.current) {
            inputRef.current.focus();
        }
    }, [setValue]);

    // Validation
    const validateInput = useCallback((text: string): { isValid: boolean; errors: string[] } => {
        const errors: string[] = [];

        if (text.trim().length === 0) {
            errors.push('Message cannot be empty');
        }

        if (text.length > MAX_MESSAGE_LENGTH) {
            errors.push('Message exceeds maximum length');
        }

        const estimatedTokens = Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
        if (estimatedTokens > MAX_TOKEN_WARNING) {
            errors.push('Message may exceed token limit');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }, []);

    // Chat management
    const clearChatHistory = useCallback(() => {
        // This would typically call a context method to clear history
        // For now, it's a placeholder
    }, []);

    const exportChatHistory = useCallback((): string => {
        return chatHistory
            .map(msg => `[${msg.timestamp.toLocaleTimeString()}] ${msg.type.toUpperCase()}: ${msg.content}`)
            .join('\n');
    }, [chatHistory]);

    // Accessibility
    const focusInput = useCallback(() => {
        if (inputRef.current) {
            inputRef.current.focus();
        }
    }, []);

    const stopStreaming = useCallback(() => {
        clearStreamingResponse();
    }, [clearStreamingResponse]);

    // Handle input focus events
    useEffect(() => {
        const handleFocus = () => setIsInputFocused(true);
        const handleBlur = () => setIsInputFocused(false);

        const input = inputRef.current;
        if (input) {
            input.addEventListener('focus', handleFocus);
            input.addEventListener('blur', handleBlur);

            return () => {
                input.removeEventListener('focus', handleFocus);
                input.removeEventListener('blur', handleBlur);
            };
        }
        return;
    }, []);

    // Cleanup
    useEffect(() => {
        return () => {
            if (typingTimeoutRef.current) {
                clearTimeout(typingTimeoutRef.current);
            }
        };
    }, []);

    return {
        // Input State
        inputState,
        isTyping,
        isSending: isExecuting,
        canSend,

        // Input Control
        setValue,
        clearInput,
        appendToInput,
        insertAtCursor,

        // Message Management
        sendMessage,
        sendStreamingMessage,
        retryLastMessage,

        // Chat History
        chatHistory,
        clearChatHistory,
        exportChatHistory,

        // Navigation and Shortcuts
        navigateHistory,
        insertTemplate,

        // Suggestions and Auto-completion
        suggestions: [], // Removed suggestions from return
        showSuggestions,
        selectSuggestion,

        // Input Validation
        validateInput,

        // Accessibility and UX
        inputRef,
        focusInput,
        isInputFocused,

        // Streaming Response
        streamingResponse: '', // Simplified for now
        isReceivingStream: false, // Simplified for now
        stopStreaming
    };
} 