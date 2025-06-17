import {
    ConversationHistory,
    UniversalMessage,
    UniversalMessageRole
} from '@robota-sdk/core';
import type { FunctionCall, FunctionCallResult } from '@robota-sdk/tools';
import type { EnhancedConversationHistory, ConfigurationChange } from '../types/chat';
import { v4 as uuidv4 } from 'uuid';

export class EnhancedConversationHistoryImpl implements EnhancedConversationHistory {
    private messages: UniversalMessage[] = [];
    public configurations: ConfigurationChange[] = [];
    private maxHistorySize: number;

    constructor(maxHistorySize: number = 1000) {
        this.maxHistorySize = maxHistorySize;
    }

    // ConversationHistory interface implementation
    addMessage(message: UniversalMessage): void {
        this.messages.push(message);
        this._enforceMaxSize();
    }

    addUserMessage(content: string, metadata?: Record<string, any>): void {
        this.addMessage({
            role: 'user',
            content,
            timestamp: new Date(),
            metadata
        });
    }

    addAssistantMessage(content: string, functionCall?: FunctionCall, metadata?: Record<string, any>): void {
        this.addMessage({
            role: 'assistant',
            content,
            functionCall,
            timestamp: new Date(),
            metadata
        });
    }

    addSystemMessage(content: string, metadata?: Record<string, any>): void {
        this.addMessage({
            role: 'system',
            content,
            timestamp: new Date(),
            metadata
        });
    }

    addToolMessage(toolResult: FunctionCallResult, metadata?: Record<string, any>): void {
        const content = toolResult.error
            ? `Tool execution error: ${toolResult.error}`
            : `Tool result: ${JSON.stringify(toolResult.result)}`;

        this.addMessage({
            role: 'tool',
            content,
            name: toolResult.name,
            toolResult,
            timestamp: new Date(),
            metadata
        });
    }

    addToolMessageWithId(content: string, toolCallId: string, toolName: string, metadata?: Record<string, any>): void {
        this.addMessage({
            role: 'tool',
            content,
            name: toolName,
            toolCallId,
            toolResult: {
                name: toolName,
                result: content,
                error: undefined
            },
            timestamp: new Date(),
            metadata
        });
    }

    getMessages(): UniversalMessage[] {
        return [...this.messages];
    }

    getMessagesByRole(role: UniversalMessageRole): UniversalMessage[] {
        return this.messages.filter(msg => msg.role === role);
    }

    getRecentMessages(count: number): UniversalMessage[] {
        return this.messages.slice(-count);
    }

    clear(): void {
        this.messages = [];
        this.configurations = [];
    }

    getMessageCount(): number {
        return this.messages.length;
    }

    // Enhanced functionality for configuration tracking
    addConfigurationChange(change: ConfigurationChange): void {
        this.configurations.push({
            ...change,
            id: change.id || uuidv4(),
            timestamp: change.timestamp || new Date()
        });
    }

    getConfigurationHistory(): ConfigurationChange[] {
        return [...this.configurations];
    }

    clearConfigurationHistory(): void {
        this.configurations = [];
    }

    // Additional utility methods
    updateMessage(index: number, content: string): boolean {
        if (index >= 0 && index < this.messages.length) {
            this.messages[index] = {
                ...this.messages[index],
                content,
                timestamp: new Date()
            };
            return true;
        }
        return false;
    }

    removeMessage(index: number): boolean {
        if (index >= 0 && index < this.messages.length) {
            this.messages.splice(index, 1);
            return true;
        }
        return false;
    }

    getConfigurationChangeCount(): number {
        return this.configurations.length;
    }

    // Export/Import functionality
    export(): string {
        return JSON.stringify({
            messages: this.messages,
            configurations: this.configurations,
            exportedAt: new Date()
        }, null, 2);
    }

    import(data: string): void {
        try {
            const parsed = JSON.parse(data);
            if (parsed.messages && Array.isArray(parsed.messages)) {
                this.messages = parsed.messages;
            }
            if (parsed.configurations && Array.isArray(parsed.configurations)) {
                this.configurations = parsed.configurations;
            }
        } catch (error) {
            throw new Error(`Failed to import conversation history: ${error}`);
        }
    }

    // Memory management
    getMemoryUsage(): number {
        const messagesSize = JSON.stringify(this.messages).length;
        const configurationsSize = JSON.stringify(this.configurations).length;
        return (messagesSize + configurationsSize) / (1024 * 1024); // MB
    }

    private _enforceMaxSize(): void {
        if (this.messages.length > this.maxHistorySize) {
            // Remove oldest messages, keeping system messages
            const systemMessages = this.messages.filter(m => m.role === 'system');
            const otherMessages = this.messages.filter(m => m.role !== 'system');

            // Keep recent messages within limit
            const messagesToKeep = this.maxHistorySize - systemMessages.length;
            const recentMessages = otherMessages.slice(-messagesToKeep);

            this.messages = [...systemMessages, ...recentMessages];
        }
    }
} 