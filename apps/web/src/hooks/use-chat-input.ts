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

export function useChatInput(): ChatInputHookReturn {
    const {
        executePrompt,
        executeStreamPrompt,
        retryLastExecution,
        isExecuting,
        streamingResponse,
        clearStreamingResponse,
        canExecute
    } = useRobotaExecution();

    const { conversationEvents } = usePlaygroundData();

    // Input state
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);

    // Refs
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastUserInputRef = useRef<string>('');

    // Derive chat history from conversation events
    const chatHistory = useMemo((): ChatMessage[] => {
        return conversationEvents.map(event => ({
            id: event.id,
            type: event.type === 'user_message' ? 'user' as const :
                event.type === 'assistant_response' ? 'assistant' as const :
                    event.type === 'error' ? 'error' as const : 'system' as const,
            content: event.content || '',
            timestamp: event.timestamp,
            metadata: event.metadata
        }));
    }, [conversationEvents]);

    // Get user message history for navigation
    const userMessageHistory = useMemo(() => {
        return chatHistory
            .filter(msg => msg.type === 'user')
            .map(msg => msg.content)
            .reverse(); // Most recent first
    }, [chatHistory]);

    // Input validation and statistics
    const inputState = useMemo((): ChatInputState => {
        const value = inputValue.trim();
        const errors: string[] = [];

        if (value.length === 0) {
            errors.push('Message cannot be empty');
        }

        if (value.length > 4000) {
            errors.push('Message too long (maximum 4000 characters)');
        }

        const wordCount = value.split(/\s+/).filter(word => word.length > 0).length;
        const characterCount = value.length;

        // Simple token estimation (roughly 1 token per 4 characters)
        const estimatedTokens = Math.ceil(characterCount / 4);

        if (estimatedTokens > 1000) {
            errors.push('Message may exceed token limit');
        }

        return {
            value,
            isValid: errors.length === 0,
            errors,
            wordCount,
            characterCount,
            estimatedTokens
        };
    }, [inputValue]);

    // Suggestions based on input
    const suggestions = useMemo((): string[] => {
        if (inputValue.length < 2) return [];

        const templates = [
            'Explain how',
            'Create a',
            'Help me understand',
            'What is the difference between',
            'Can you provide an example of',
            'How do I implement',
            'Debug this code:',
            'Optimize this function:',
            'Refactor this to use'
        ];

        return templates
            .filter(template =>
                template.toLowerCase().startsWith(inputValue.toLowerCase()) ||
                inputValue.toLowerCase().includes(template.toLowerCase().substring(0, 3))
            )
            .slice(0, 5);
    }, [inputValue]);

    // Derived state
    const canSend = canExecute && inputState.isValid && !isExecuting;
    const isReceivingStream = Boolean(streamingResponse);

    // Input control functions
    const setValue = useCallback((value: string) => {
        setInputValue(value);

        // Update cursor position
        if (inputRef.current) {
            setCursorPosition(inputRef.current.selectionStart || 0);
        }

        // Handle typing indicator
        setIsTyping(true);
        if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
        }
        typingTimeoutRef.current = setTimeout(() => {
            setIsTyping(false);
        }, 1000);

        // Show suggestions if appropriate
        setShowSuggestions(value.length > 1 && suggestions.length > 0);
    }, [suggestions.length]);

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
            return;
        }

        try {
            lastUserInputRef.current = messageToSend;
            clearInput();
            setHistoryIndex(-1);

            await executePrompt(messageToSend);

        } catch (error) {
            console.error('Failed to send message:', error);
            // Restore input on error
            setValue(messageToSend);
        }
    }, [inputValue, canSend, clearInput, executePrompt, setValue]);

    const sendStreamingMessage = useCallback(async (message?: string) => {
        const messageToSend = message || inputValue.trim();

        if (!canSend || !messageToSend) {
            return;
        }

        try {
            lastUserInputRef.current = messageToSend;
            clearInput();
            setHistoryIndex(-1);
            clearStreamingResponse();

            await executeStreamPrompt(messageToSend);

        } catch (error) {
            console.error('Failed to send streaming message:', error);
            setValue(messageToSend);
        }
    }, [inputValue, canSend, clearInput, executeStreamPrompt, clearStreamingResponse, setValue]);

    const retryLastMessage = useCallback(async () => {
        if (lastUserInputRef.current) {
            try {
                await retryLastExecution();
            } catch (error) {
                console.error('Failed to retry message:', error);
                setValue(lastUserInputRef.current);
            }
        }
    }, [retryLastExecution, setValue]);

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
        suggestions,
        showSuggestions,
        selectSuggestion,

        // Input Validation
        validateInput,

        // Accessibility and UX
        inputRef,
        focusInput,
        isInputFocused,

        // Streaming Response
        streamingResponse,
        isReceivingStream,
        stopStreaming
    };
} 