import type { Message } from '@robota-sdk/agents';

// Use Message type consistently
type UniversalMessage = Message;

export interface SystemMessageManager {
    setSystemPrompt(prompt: string): void;
    addSystemMessage(content: string): void;
    getSystemMessages(): UniversalMessage[];
    clearSystemMessages(): void;
    hasSystemMessages(): boolean;
}

export class SystemMessageManagerImpl implements SystemMessageManager {
    private systemMessages: UniversalMessage[] = [];

    setSystemPrompt(prompt: string): void {
        this.systemMessages = [{
            role: 'system',
            content: prompt,
            timestamp: new Date()
        }];
    }

    addSystemMessage(content: string): void {
        this.systemMessages.push({
            role: 'system',
            content,
            timestamp: new Date()
        });
    }

    getSystemMessages(): UniversalMessage[] {
        return [...this.systemMessages];
    }

    clearSystemMessages(): void {
        this.systemMessages = [];
    }

    hasSystemMessages(): boolean {
        return this.systemMessages.length > 0;
    }
} 