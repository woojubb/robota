import { CHARS_PER_TOKEN_ESTIMATE, MAX_MESSAGE_LENGTH, MAX_TOKEN_WARNING } from './constants';
import type { IInputValidationResult } from './types';

export function validateChatInputText(text: string): IInputValidationResult {
  const errors: string[] = [];

  if (text.trim().length === 0) {
    errors.push('Message cannot be empty');
  }

  if (text.length > MAX_MESSAGE_LENGTH) {
    errors.push('Message exceeds maximum length');
  }

  if (Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE) > MAX_TOKEN_WARNING) {
    errors.push('Message may exceed token limit');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
