import type { Message } from '../interfaces/ai-provider';

/**
 * System message management class
 * Manages system prompts and system messages.
 */
export class SystemMessageManager {
    private systemPrompt?: string;
    private systemMessages?: Message[];

    /**
     * Set a single system prompt
     * 
     * @param prompt - System prompt content
     */
    setSystemPrompt(prompt: string): void {
        this.systemPrompt = prompt;
        this.systemMessages = undefined;
    }

    /**
     * Set multiple system messages
     * 
     * @param messages - Array of system messages
     */
    setSystemMessages(messages: Message[]): void {
        this.systemPrompt = undefined;
        this.systemMessages = messages;
    }

    /**
     * Add a new system message to existing system messages
     * 
     * @param content - Content of the system message to add
     */
    addSystemMessage(content: string): void {
        // If systemPrompt is set and systemMessages is empty or has only one message identical to systemPrompt
        if (this.systemPrompt) {
            if (!this.systemMessages ||
                (this.systemMessages.length === 1 &&
                    this.systemMessages[0].role === 'system' &&
                    this.systemMessages[0].content === this.systemPrompt)) {
                this.systemMessages = [
                    { role: 'system', content: this.systemPrompt },
                    { role: 'system', content }
                ];
            } else {
                this.systemMessages.push({ role: 'system', content });
            }
            this.systemPrompt = undefined;
        } else {
            if (!this.systemMessages) {
                this.systemMessages = [];
            }
            this.systemMessages.push({ role: 'system', content });
        }
    }

    /**
     * Get the current system prompt
     */
    getSystemPrompt(): string | undefined {
        return this.systemPrompt;
    }

    /**
     * Get the current system messages
     */
    getSystemMessages(): Message[] | undefined {
        return this.systemMessages;
    }

    /**
     * Check if system messages are configured
     */
    hasSystemMessages(): boolean {
        return !!(this.systemPrompt || (this.systemMessages && this.systemMessages.length > 0));
    }

    /**
     * Clear system messages
     */
    clear(): void {
        this.systemPrompt = undefined;
        this.systemMessages = undefined;
    }
} 