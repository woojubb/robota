import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { RefObject } from 'react';
import type { IUseBlockTrackingResult } from '../use-block-tracking';
import type { IPlaygroundExecutorResult } from '../../lib/playground/robota-executor';

export interface IChatMessage {
  id: string;
  type: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  metadata?: Record<string, TUniversalValue>;
}

export interface IChatInputState {
  value: string;
  isValid: boolean;
  errors: string[];
  wordCount: number;
  characterCount: number;
  estimatedTokens: number;
}

export interface IChatInputOptions {
  blockTracking?: IUseBlockTrackingResult;
  maxLength?: number;
  enableValidation?: boolean;
  placeholder?: string;
}

export interface IInputValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface IChatInputHookReturn {
  inputState: IChatInputState;
  isTyping: boolean;
  isSending: boolean;
  canSend: boolean;
  setValue: (value: string) => void;
  clearInput: () => void;
  appendToInput: (text: string) => void;
  insertAtCursor: (text: string) => void;
  sendMessage: (message?: string) => Promise<IPlaygroundExecutorResult | undefined>;
  sendStreamingMessage: (message?: string) => Promise<IPlaygroundExecutorResult | undefined>;
  retryLastMessage: () => Promise<void>;
  chatHistory: IChatMessage[];
  clearChatHistory: () => void;
  exportChatHistory: () => string;
  navigateHistory: (direction: 'up' | 'down') => void;
  insertTemplate: (template: string) => void;
  suggestions: string[];
  showSuggestions: boolean;
  selectSuggestion: (suggestion: string) => void;
  validateInput: (text: string) => IInputValidationResult;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  focusInput: () => void;
  isInputFocused: boolean;
  streamingResponse: string;
  isReceivingStream: boolean;
  stopStreaming: () => void;
}
