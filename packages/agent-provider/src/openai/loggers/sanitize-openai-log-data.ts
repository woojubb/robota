import type { IOpenAILogData } from '../types/api-types';

/**
 * Creates a defensive deep copy of OpenAI log data.
 * SSOT utility shared by payload loggers.
 */
export function sanitizeOpenAILogData(payload: IOpenAILogData): IOpenAILogData {
  // Create a deep copy to avoid modifying original
  const sanitized = JSON.parse(JSON.stringify(payload)) as IOpenAILogData;

  // Remove or mask sensitive data if needed.
  // For now, we keep everything as OpenAI payloads don't contain API keys.
  return sanitized;
}
