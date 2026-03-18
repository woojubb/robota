import OpenAI from 'openai';
import type { TUniversalMessage, IAssistantMessage } from '@robota-sdk/agent-core';

/**
 * OpenAI Conversation Adapter
 *
 * Converts between TUniversalMessage format and OpenAI native types.
 * Provides bidirectional conversion for seamless integration.
 *
 * @public
 */
export class OpenAIConversationAdapter {
  /**
   * Filter messages for OpenAI compatibility
   *
   * OpenAI has specific requirements:
   * - Tool messages must have valid toolCallId
   * - Messages must be in proper sequence
   * - Tool messages without toolCallId should be excluded
   */
  static filterMessagesForOpenAI(messages: TUniversalMessage[]): TUniversalMessage[] {
    return messages.filter((msg) => {
      // Always include user, assistant, and system messages
      if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') {
        return true;
      }

      // For tool messages, only include if they have a valid toolCallId
      if (msg.role === 'tool') {
        // Must have toolCallId and it must not be empty or 'unknown'
        return !!(msg.toolCallId && msg.toolCallId.trim() !== '' && msg.toolCallId !== 'unknown');
      }

      return false;
    });
  }

  /**
   * Convert TUniversalMessage array to OpenAI message format
   * Now properly handles tool messages for OpenAI's tool calling feature
   */
  static toOpenAIFormat(messages: TUniversalMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    // First filter messages for OpenAI compatibility
    const filteredMessages = this.filterMessagesForOpenAI(messages);
    return filteredMessages.map((msg) => this.convertMessage(msg));
  }

  /**
   * Convert a single TUniversalMessage to OpenAI format
   * Handles all message types including tool messages
   */
  static convertMessage(msg: TUniversalMessage): OpenAI.Chat.ChatCompletionMessageParam {
    const messageRole = msg.role;

    if (messageRole === 'user') {
      return {
        role: 'user',
        content: msg.content,
      };
    }

    if (messageRole === 'assistant') {
      const assistantMsg = msg as IAssistantMessage;

      // Handle tool_calls format
      if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
        const result: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          // CRITICAL: OpenAI API requires content to be null (not empty string) when tool_calls are present
          // VERIFIED: 2024-12 - This prevents "400 Bad Request" errors from OpenAI API
          // DO NOT CHANGE without testing against actual OpenAI API
          content: assistantMsg.content === '' ? null : assistantMsg.content || null,
          tool_calls: assistantMsg.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.function.name,
              arguments: toolCall.function.arguments,
            },
          })),
        };
        return result;
      }

      // Regular assistant message (without tool calls)
      // VERIFIED: OpenAI accepts both null and string content for regular messages
      // We preserve null when content is null or empty string for API consistency
      return {
        role: 'assistant',
        content:
          assistantMsg.content === null
            ? null
            : assistantMsg.content === ''
              ? null
              : assistantMsg.content || '',
      };
    }

    if (messageRole === 'system') {
      return {
        role: 'system',
        content: msg.content,
      };
    }

    // Handle tool messages for OpenAI tool calling
    if (messageRole === 'tool') {
      if (!msg.toolCallId || msg.toolCallId.trim() === '') {
        throw new Error(`Tool message missing toolCallId: ${JSON.stringify(msg)}`);
      }

      const result: OpenAI.Chat.ChatCompletionToolMessageParam = {
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.toolCallId,
      };
      return result;
    }

    const exhaustive: never = messageRole;
    throw new Error(`Unsupported message role: ${exhaustive}`);
  }

  /**
   * Add system prompt to message array if needed
   */
  static addSystemPromptIfNeeded(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    systemPrompt?: string,
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    if (!systemPrompt) {
      return messages;
    }

    // Check if system message already exists
    const hasSystemMessage = messages.some((msg) => msg.role === 'system');

    if (hasSystemMessage) {
      return messages;
    }

    // Add system prompt at the beginning
    return [{ role: 'system', content: systemPrompt }, ...messages];
  }
}
