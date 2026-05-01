import type OpenAI from 'openai';
import type { ILogger, TUniversalMessage } from '@robota-sdk/agent-core';
import { OpenAICompatibleResponseParser } from '@robota-sdk/agent-provider-openai-compatible';

/**
 * OpenAI response parser compatibility wrapper.
 *
 * The implementation delegates to the shared OpenAI-compatible parser while
 * preserving the OpenAI-branded error messages that are part of this package's
 * current test contract.
 */
export class OpenAIResponseParser {
  private readonly parser: OpenAICompatibleResponseParser;

  constructor(logger?: ILogger) {
    this.parser = new OpenAICompatibleResponseParser({ logger });
  }

  parseResponse(response: OpenAI.Chat.ChatCompletion): TUniversalMessage {
    try {
      return this.parser.parseResponse(response);
    } catch (error) {
      const message = normalizeParserMessage(
        error instanceof Error ? error.message : 'OpenAI response parsing failed',
      );
      throw new Error(`OpenAI response parsing failed: ${message}`);
    }
  }

  parseStreamingChunk(chunk: OpenAI.Chat.ChatCompletionChunk): TUniversalMessage | null {
    try {
      return this.parser.parseStreamingChunk(chunk);
    } catch (error) {
      const message = normalizeParserMessage(
        error instanceof Error ? error.message : 'OpenAI chunk parsing failed',
      );
      throw new Error(`OpenAI chunk parsing failed: ${message}`);
    }
  }
}

function normalizeParserMessage(message: string): string {
  return message
    .replace(/^OpenAI-compatible response parsing failed: /, '')
    .replace(/^OpenAI-compatible chunk parsing failed: /, '')
    .replace('OpenAI-compatible response', 'OpenAI response');
}
