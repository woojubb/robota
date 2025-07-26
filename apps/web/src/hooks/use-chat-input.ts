'use client';

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

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useRobotaExecution } from './use-robota-execution';
import { usePlaygroundData } from './use-playground-data';
import type { UseBlockTrackingResult } from './use-block-tracking';

export interface ChatMessage {
    id: string;
    type: 'user' | 'assistant' | 'system' | 'error';
    content: string;
    timestamp: Date;
    isStreaming?: boolean;
    metadata?: Record<string, unknown>;
}

export interface ChatInputState {
    value: string;
    isValid: boolean;
    errors: string[];
    wordCount: number;
    characterCount: number;
    estimatedTokens: number;
}

export interface ChatInputOptions {
    /** Block tracking integration for automatic block creation */
    blockTracking?: UseBlockTrackingResult;

    /** Maximum input length */
    maxLength?: number;

    /** Enable input validation */
    enableValidation?: boolean;

    /** Placeholder text */
    placeholder?: string;
}

export interface ChatInputHookReturn {
    // Input State
    inputState: ChatInputState;
    isTyping: boolean;
    isSending: boolean;
    canSend: boolean;

    // Input Control
    setValue: (value: string) => void;
    clearInput: () => void;
    appendToInput: (text: string) => void;
    insertAtCursor: (text: string) => void;

    // Message Management
    sendMessage: (message?: string) => Promise<void>;
    sendStreamingMessage: (message?: string) => Promise<void>;
    retryLastMessage: () => Promise<void>;

    // Chat History
    chatHistory: ChatMessage[];
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
    inputRef: React.RefObject<HTMLTextAreaElement | null>;
    focusInput: () => void;
    isInputFocused: boolean;

    // Streaming Response
    streamingResponse: string;
    isReceivingStream: boolean;
    stopStreaming: () => void;
}

export function useChatInput(options: ChatInputOptions = {}): ChatInputHookReturn {
    const {
        blockTracking,
        maxLength = 10000,
        enableValidation = true,
        placeholder = "Type your message..."
    } = options;

    const {
        executePrompt,
        executeStreamPrompt,
        lastResult,
        isExecuting,
        clearStreamingResponse
    } = useRobotaExecution();

    const { conversationEvents } = usePlaygroundData();

    // Input state
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);

    // Chat history (simplified for now)
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const userMessageHistory = useMemo(() => {
        return chatHistory.filter(msg => msg.type === 'user').map(msg => msg.content);
    }, [chatHistory]);

    // Refs
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastUserInputRef = useRef<string>('');

    // Input validation and state calculation
    const inputState = useMemo<ChatInputState>(() => {
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
            estimatedTokens: Math.ceil(wordCount * 1.3) // Rough estimate
        };
    }, [inputValue, enableValidation, maxLength]);

    // Derived state
    const canSend = !isExecuting && inputState.isValid; // Can send when NOT executing and input is valid
    const isReceivingStream = false; // Simplified for now

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
        }, 1000);

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
                setCursorPosition(newPosition);
            }
        }, 0);
    }, [inputValue, setValue]);

    // Message sending
    const sendMessage = useCallback(async (message?: string) => {
        const messageToSend = message || inputValue.trim();

        if (!canSend || !messageToSend) {
            console.warn('⚠️ sendMessage blocked:', { canSend, messageToSend });
            return;
        }

        try {
            lastUserInputRef.current = messageToSend;
            clearInput();
            setHistoryIndex(-1);

            console.log('📤 Sending message:', messageToSend);
            const result = await executePrompt(messageToSend);
            console.log('✅ sendMessage result:', result);
            return result;

        } catch (error) {
            console.error('❌ Failed to send message:', error);
            console.error('❌ Error details:', {
                message: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                messageToSend
            });
            // Restore input on error
            setValue(messageToSend);
            throw error; // Re-throw to let parent handle
        }
    }, [inputValue, canSend, clearInput, executePrompt, setValue]);

    const sendStreamingMessage = useCallback(async (message?: string) => {
        const messageToSend = message || inputValue.trim();

        if (!canSend || !messageToSend) {
            console.warn('⚠️ sendStreamingMessage blocked:', { canSend, messageToSend });
            return;
        }

        try {
            lastUserInputRef.current = messageToSend;
            clearInput();
            setHistoryIndex(-1);
            clearStreamingResponse();

            console.log('📤 Sending streaming message:', messageToSend);
            const result = await executeStreamPrompt(messageToSend);
            console.log('✅ sendStreamingMessage result:', result);
            return result;

        } catch (error) {
            console.error('❌ Failed to send streaming message:', error);
            console.error('❌ Error details:', {
                message: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                messageToSend
            });
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
                console.error('Failed to retry message:', error);
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

        if (text.length > 4000) {
            errors.push('Message exceeds maximum length');
        }

        const estimatedTokens = Math.ceil(text.length / 4);
        if (estimatedTokens > 1000) {
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