import type { UniversalMessage } from './conversation-history';
import { isUserMessage, isAssistantMessage, isToolMessage } from './conversation-history';
import type { Message, MessageRole } from './interfaces/ai-provider';

/**
 * Utility functions collection
 */

/**
 * Function to split text into chunks
 * 
 * @param text Text to split
 * @param chunkSize Maximum size of each chunk
 * @returns Array of text chunks
 */
export function splitTextIntoChunks(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];

  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.substring(i, i + chunkSize));
  }

  return chunks;
}

/**
 * Function to remove undefined values from object
 * 
 * @param obj Object to clean
 * @returns Object with undefined values removed
 */
export function removeUndefined<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj };

  for (const key in result) {
    if (result[key] === undefined) {
      delete result[key];
    } else if (typeof result[key] === 'object' && result[key] !== null) {
      result[key] = removeUndefined(result[key] as Record<string, unknown>) as T[Extract<keyof T, string>];
    }
  }

  return result;
}

/**
 * Function to check if a string is JSON
 * 
 * @param str String to check
 * @returns Whether it's JSON
 */
export function isJSON(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Delay function
 * 
 * @param ms Delay time in milliseconds
 * @returns Promise
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Function to roughly estimate token count
 * 
 * @param text Text to measure
 * @returns Approximate token count
 */
export function estimateTokenCount(text: string): number {
  // For English, tokens are roughly 1.3 times the number of words
  // For other languages, character-based tokenization is used
  // Here we use a combination of word count and character count for simple estimation

  // Extract English words
  const englishWords = text.match(/[a-zA-Z]+/g)?.length || 0;

  // Extract non-ASCII characters (including Korean, Chinese, Japanese, etc.)
  const nonAsciiChars = text.match(/[^\x00-\x7F]/g)?.length || 0;

  // Numbers and special characters
  const others = text.length - (text.match(/[a-zA-Z\x00-\x7F]/g)?.join('').length || 0);

  return Math.ceil(englishWords * 1.3 + nonAsciiChars + others * 0.5);
}

/**
 * Function to extract complete JSON objects from a string stream
 * 
 * @param text JSON string fragment
 * @returns Complete JSON objects and remaining string
 */
export function extractJSONObjects(text: string): { objects: unknown[], remaining: string } {
  const objects: unknown[] = [];
  let remaining = text;
  let match;

  // Regular expression for JSON object exploration
  // Simple method for accurate JSON extraction, but may fail with nested objects
  const regex = /{(?:[^{}]|{(?:[^{}]|{[^{}]*})*})*}/g;

  while ((match = regex.exec(remaining)) !== null) {
    try {
      const jsonStr = match[0];
      const jsonObj = JSON.parse(jsonStr);
      objects.push(jsonObj);

      // Remove matched part
      remaining = remaining.slice(0, match.index) + remaining.slice(match.index + jsonStr.length);

      // Reset regex index
      regex.lastIndex = 0;
    } catch (e) {
      // Ignore invalid JSON
      regex.lastIndex = match.index + 1;
    }
  }

  return { objects, remaining };
}

/**
 * Logger utility (console.log replacement)
 */
export const logger = {
  info: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[INFO]', ...args);
    }
  },
  warn: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[WARN]', ...args);
    }
  },
  error: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[ERROR]', ...args);
    }
  }
};

/**
 * Helper function to convert UniversalMessage to basic Message format
 * Can be used in AI Provider adapters.
 */
export function convertUniversalToBaseMessage(universalMessage: UniversalMessage): Message {
  const baseMessage: Message = {
    role: universalMessage.role === 'tool' ? 'function' : universalMessage.role as MessageRole,
    content: universalMessage.content || ''
  };

  // Use type guards to safely access properties
  if (isUserMessage(universalMessage) && universalMessage.name) {
    baseMessage.name = universalMessage.name;
  }

  if (isAssistantMessage(universalMessage) && universalMessage.functionCall) {
    baseMessage.functionCall = universalMessage.functionCall;
  }

  if (isToolMessage(universalMessage) && universalMessage.toolResult) {
    baseMessage.functionResult = universalMessage.toolResult;
  }

  return baseMessage;
}

/**
 * Helper function to convert UniversalMessage array to basic Message array
 */
export function convertUniversalToBaseMessages(universalMessages: UniversalMessage[]): Message[] {
  return universalMessages.map(convertUniversalToBaseMessage);
}

/**
 * Message conversion interface that AI Provider adapters should implement
 */
export interface MessageAdapter<T = any> {
  /**
   * Convert UniversalMessage to specific AI Provider format
   */
  convertFromUniversal(universalMessage: UniversalMessage): T;

  /**
   * Convert UniversalMessage array to specific AI Provider format array
   */
  convertFromUniversalMessages(universalMessages: UniversalMessage[]): T[];
} 