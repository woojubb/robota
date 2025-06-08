import type { ConversationHistory } from '../conversation-history';
import type { ModelResponse, StreamingResponseChunk } from '../interfaces/ai-provider';
import type { ExecutionService } from '../services/execution-service';
import type { SystemMessageManager } from '../managers/system-message-manager';
import type { RunOptions } from '../types';

/**
 * Conversation related pure functions
 * Separated conversation related logic from Robota class into pure functions
 */

/**
 * Pure function to execute prompt
 */
export async function executePrompt(
    prompt: string,
    options: RunOptions,
    executionService: ExecutionService,
    conversationHistory: ConversationHistory,
    systemMessageManager: SystemMessageManager
): Promise<string> {
    return executionService.executePrompt(prompt, {
        conversationHistory,
        systemMessageManager,
        options
    });
}

/**
 * Pure function to execute streaming response
 */
export async function executeStream(
    prompt: string,
    options: RunOptions,
    executionService: ExecutionService,
    conversationHistory: ConversationHistory,
    systemMessageManager: SystemMessageManager
): Promise<AsyncIterable<StreamingResponseChunk>> {
    return executionService.executeStream(prompt, {
        conversationHistory,
        systemMessageManager,
        options
    });
}

/**
 * Pure function to add response to conversation history
 */
export function addResponseToConversationHistory(
    response: ModelResponse,
    conversationHistory: ConversationHistory
): void {
    conversationHistory.addAssistantMessage(response.content || '', response.functionCall);
}

/**
 * Pure function to clear conversation history
 */
export function clearConversationHistory(
    conversationHistory: ConversationHistory
): void {
    conversationHistory.clear();
} 