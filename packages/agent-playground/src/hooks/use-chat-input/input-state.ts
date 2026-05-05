import { TOKEN_ESTIMATE_MULTIPLIER } from './constants';
import type { IChatInputState } from './types';

interface ICalculateChatInputStateParams {
  value: string;
  enableValidation: boolean;
  maxLength: number;
}

export function calculateChatInputState({
  value,
  enableValidation,
  maxLength,
}: ICalculateChatInputStateParams): IChatInputState {
  const trimmed = value.trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
  const characterCount = value.length;
  const errors = enableValidation
    ? calculateInputStateErrors(trimmed, characterCount, maxLength)
    : [];

  return {
    value,
    isValid: errors.length === 0 && trimmed.length > 0,
    errors,
    wordCount,
    characterCount,
    estimatedTokens: Math.ceil(wordCount * TOKEN_ESTIMATE_MULTIPLIER),
  };
}

function calculateInputStateErrors(
  trimmed: string,
  characterCount: number,
  maxLength: number,
): string[] {
  const errors: string[] = [];

  if (characterCount > maxLength) {
    errors.push(`Message too long (${characterCount}/${maxLength} characters)`);
  }

  if (trimmed.length === 0 && characterCount > 0) {
    errors.push('Message cannot be empty or whitespace only');
  }

  return errors;
}
