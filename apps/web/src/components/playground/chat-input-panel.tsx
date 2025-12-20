'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Send, Loader2, Clock } from 'lucide-react';
import { useChatInput } from '@/hooks/use-chat-input';
import { useRobotaExecution } from '@/hooks/use-robota-execution';
import { WebLogger } from '@/lib/web-logger';

interface ChatInputPanelProps {
    onClose: () => void;
}

export function ChatInputPanel({ onClose }: ChatInputPanelProps) {
    const { executePrompt, executeStreamPrompt, isExecuting } = useRobotaExecution();
    const {
        inputState,
        setValue,
        sendMessage,
        sendStreamingMessage,
        inputRef,
        canSend
    } = useChatInput();

    const [useStreaming, setUseStreaming] = useState(true);
    const [recentPrompts, setRecentPrompts] = useState<string[]>([]);

    // localStorage key for recent prompts
    const RECENT_PROMPTS_KEY = 'robota-recent-chat-prompts';

    // Load recent prompts from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(RECENT_PROMPTS_KEY);
            if (stored) {
                const prompts = JSON.parse(stored);
                if (Array.isArray(prompts)) {
                    setRecentPrompts(prompts.slice(0, 3)); // Ensure max 3 items
                }
            }
        } catch (error) {
            WebLogger.error('Failed to load recent prompts', { error: error instanceof Error ? error.message : String(error) });
            setRecentPrompts([]);
        }
    }, []);

    // Save recent prompts to localStorage
    const saveRecentPrompts = useCallback((newPrompts: string[]) => {
        try {
            localStorage.setItem(RECENT_PROMPTS_KEY, JSON.stringify(newPrompts));
            setRecentPrompts(newPrompts);
        } catch (error) {
            WebLogger.error('Failed to save recent prompts', { error: error instanceof Error ? error.message : String(error) });
        }
    }, []);

    // Add new prompt to recent prompts (max 3, most recent first)
    const addToRecentPrompts = useCallback((prompt: string) => {
        const trimmedPrompt = prompt.trim();
        if (!trimmedPrompt) return;

        setRecentPrompts(current => {
            // Remove if already exists to avoid duplicates
            const filtered = current.filter(p => p !== trimmedPrompt);
            // Add to beginning and limit to 3
            const updated = [trimmedPrompt, ...filtered].slice(0, 3);

            // Save to localStorage
            try {
                localStorage.setItem(RECENT_PROMPTS_KEY, JSON.stringify(updated));
            } catch (error) {
                WebLogger.error('Failed to save recent prompts', { error: error instanceof Error ? error.message : String(error) });
            }

            return updated;
        });
    }, []);

    // Handle message sending
    const handleSendMessage = useCallback(async () => {
        if (!canSend || !inputState.value.trim()) return;

        const messageToSend = inputState.value.trim();

        try {
            // Save to recent prompts before sending
            addToRecentPrompts(messageToSend);

            // Close chat modal immediately on send for better UX
            onClose();
            if (useStreaming) {
                await sendStreamingMessage(messageToSend);
            } else {
                await sendMessage(messageToSend);
            }
        } catch (error) {
            WebLogger.error('Failed to send message', { error: error instanceof Error ? error.message : String(error) });
            // TODO: Show error toast
        }
    }, [canSend, inputState.value, onClose, useStreaming, sendStreamingMessage, sendMessage, addToRecentPrompts]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    // Handle clicking on a recent prompt
    const handleRecentPromptClick = useCallback((prompt: string) => {
        setValue(prompt);
        if (inputRef.current) {
            inputRef.current.focus();
        }
    }, [setValue, inputRef]);

    return (
        <div className="space-y-4">
            {/* Recent Prompts */}
            {recentPrompts.length > 0 && (
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Clock className="h-3 w-3 text-gray-500" />
                        <Label className="text-xs text-gray-600">Recent Prompts</Label>
                    </div>
                    <div className="space-y-1">
                        {recentPrompts.map((prompt, index) => (
                            <Button
                                key={index}
                                variant="outline"
                                size="sm"
                                className="w-full h-auto py-2 px-3 text-xs text-left justify-start"
                                onClick={() => handleRecentPromptClick(prompt)}
                                disabled={isExecuting}
                                title={prompt}
                            >
                                <span className="truncate">{prompt}</span>
                            </Button>
                        ))}
                    </div>
                </div>
            )}

            {/* Input Area */}
            <div className="space-y-2">
                <Label htmlFor="chat-input" className="text-sm font-medium">
                    Message
                </Label>
                <Textarea
                    ref={inputRef}
                    id="chat-input"
                    value={inputState.value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type your message... (Cmd/Ctrl + Enter to send)"
                    className="min-h-[120px] resize-none"
                    disabled={isExecuting}
                />

                {/* Input Stats */}
                <div className="flex justify-between items-center text-xs text-gray-500">
                    <div className="flex gap-3">
                        <span>{inputState.wordCount} words</span>
                        <span>{inputState.characterCount} chars</span>
                        <span>~{inputState.estimatedTokens} tokens</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {inputState.errors.length > 0 && (
                            <Badge variant="destructive" className="text-xs">
                                {inputState.errors.length} error{inputState.errors.length > 1 ? 's' : ''}
                            </Badge>
                        )}
                        {inputState.isValid && (
                            <Badge variant="secondary" className="text-xs">
                                Ready
                            </Badge>
                        )}
                    </div>
                </div>

                {/* Error Messages */}
                {inputState.errors.length > 0 && (
                    <div className="space-y-1">
                        {inputState.errors.map((error, index) => (
                            <p key={index} className="text-xs text-red-600">
                                {error}
                            </p>
                        ))}
                    </div>
                )}
            </div>

            {/* Options */}
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                    <Switch
                        id="streaming"
                        checked={useStreaming}
                        onCheckedChange={setUseStreaming}
                        disabled={isExecuting}
                    />
                    <Label htmlFor="streaming" className="text-sm">
                        Streaming response
                    </Label>
                </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2">
                <Button
                    variant="outline"
                    onClick={onClose}
                    disabled={isExecuting}
                >
                    Cancel
                </Button>
                <Button
                    onClick={handleSendMessage}
                    disabled={!canSend || isExecuting}
                    className="min-w-[100px]"
                >
                    {isExecuting ? (
                        <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Sending...
                        </>
                    ) : (
                        <>
                            <Send className="h-4 w-4 mr-2" />
                            Send
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
}
