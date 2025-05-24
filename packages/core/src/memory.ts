import type { Message } from './interfaces/ai-provider';

/**
 * Memory interface
 * 
 * Memory is responsible for storing and managing conversation history.
 */
export interface Memory {
  /**
   * Add a message to memory.
   */
  addMessage(message: Message): void;

  /**
   * Get all stored messages.
   */
  getMessages(): Message[];

  /**
   * Clear stored messages.
   */
  clear(): void;
}

/**
 * Basic in-memory implementation
 */
export class SimpleMemory implements Memory {
  private messages: Message[] = [];

  /**
   * Maximum number of stored messages (0 means unlimited)
   */
  private maxMessages: number;

  constructor(options?: { maxMessages?: number }) {
    this.maxMessages = options?.maxMessages || 0;
  }

  addMessage(message: Message): void {
    this.messages.push(message);

    // Apply maximum message count limit
    if (this.maxMessages > 0 && this.messages.length > this.maxMessages) {
      // Always keep system messages
      const systemMessages = this.messages.filter(m => m.role === 'system');
      const nonSystemMessages = this.messages.filter(m => m.role !== 'system');

      // Trim only non-system messages
      const remainingCount = this.maxMessages - systemMessages.length;
      const trimmedNonSystemMessages = nonSystemMessages.slice(-remainingCount);

      // Combine system messages with trimmed non-system messages
      this.messages = [...systemMessages, ...trimmedNonSystemMessages];
    }
  }

  getMessages(): Message[] {
    return this.messages;
  }

  clear(): void {
    this.messages = [];
  }
}

/**
 * Memory that maintains system messages
 */
export class PersistentSystemMemory implements Memory {
  private memory: SimpleMemory;
  private systemPrompt: string;

  constructor(systemPrompt: string, options?: { maxMessages?: number }) {
    this.memory = new SimpleMemory(options);
    this.systemPrompt = systemPrompt;

    // Add system message
    this.memory.addMessage({
      role: 'system',
      content: this.systemPrompt
    });
  }

  addMessage(message: Message): void {
    this.memory.addMessage(message);
  }

  getMessages(): Message[] {
    return this.memory.getMessages();
  }

  clear(): void {
    this.memory.clear();

    // Add system message again
    this.memory.addMessage({
      role: 'system',
      content: this.systemPrompt
    });
  }

  /**
   * Update system prompt
   */
  updateSystemPrompt(systemPrompt: string): void {
    this.systemPrompt = systemPrompt;

    // Remove existing system messages
    const nonSystemMessages = this.memory.getMessages().filter(m => m.role !== 'system');
    this.memory.clear();

    // Add new system message
    this.memory.addMessage({
      role: 'system',
      content: this.systemPrompt
    });

    // Re-add existing non-system messages
    for (const message of nonSystemMessages) {
      this.memory.addMessage(message);
    }
  }
} 