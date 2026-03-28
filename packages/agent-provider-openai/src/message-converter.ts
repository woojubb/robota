import OpenAI from 'openai';
import type {
  TUniversalMessage,
  IToolSchema,
  IAssistantMessage,
  IToolCall,
} from '@robota-sdk/agent-core';

/**
 * Convert TUniversalMessage array to OpenAI chat completion message format.
 */
export function convertToOpenAIMessages(
  messages: TUniversalMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    switch (msg.role) {
      case 'user':
        return {
          role: 'user' as const,
          content: msg.content || '',
        };
      case 'assistant': {
        const assistantMsg = msg as IAssistantMessage;
        if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
          return {
            role: 'assistant' as const,
            // IMPORTANT: Preserve null for tool calls as per OpenAI API spec
            content: assistantMsg.content === '' ? null : assistantMsg.content || null,
            tool_calls: assistantMsg.toolCalls.map((toolCall: IToolCall) => ({
              id: toolCall.id,
              type: 'function' as const,
              function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
              },
            })),
          };
        }
        return {
          role: 'assistant' as const,
          content: msg.content || '',
        };
      }
      case 'system':
        return {
          role: 'system' as const,
          content: msg.content || '',
        };
      case 'tool':
        return {
          role: 'tool' as const,
          content: msg.content || '',
          tool_call_id: msg.toolCallId || '',
        };
      default: {
        const exhaustive: never = msg;
        throw new Error(`Unsupported message role: ${(exhaustive as { role: string }).role}`);
      }
    }
  });
}

/**
 * Convert tool schemas to OpenAI function tool format.
 */
export function convertToOpenAITools(tools: IToolSchema[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
