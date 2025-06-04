import type { ConversationHistory } from '../conversation-history';
import type { ModelResponse, StreamingResponseChunk } from '../interfaces/ai-provider';
import type { ExecutionService } from '../services/execution-service';
import type { SystemMessageManager } from '../managers/system-message-manager';
import type { RunOptions } from '../types';

/**
 * 대화 관련 순수 함수들
 * Robota 클래스의 대화 관련 로직을 순수 함수로 분리
 */

/**
 * 프롬프트를 실행하는 순수 함수
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
 * 스트리밍 응답을 실행하는 순수 함수
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
 * 응답을 대화 히스토리에 추가하는 순수 함수
 */
export function addResponseToConversationHistory(
    response: ModelResponse,
    conversationHistory: ConversationHistory
): void {
    conversationHistory.addAssistantMessage(response.content || '', response.functionCall);
}

/**
 * 대화 히스토리를 지우는 순수 함수
 */
export function clearConversationHistory(
    conversationHistory: ConversationHistory
): void {
    conversationHistory.clear();
} 