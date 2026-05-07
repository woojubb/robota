'use client';

import { useCallback, useRef, useState, type KeyboardEvent } from 'react';

import { findLastUserMessage } from './message-history';
import { useCopyFeedback } from './use-copy-feedback';
import { useSendMessage } from './use-send-message';
import type { IChatPanelMessage, IChatPanelProps } from './types';

interface IUseChatInterfaceStateReturn {
  messages: IChatPanelMessage[];
  input: string;
  isLoading: boolean;
  copiedId: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  setInput: (input: string) => void;
  sendMessage: () => Promise<void>;
  handleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  copyToClipboard: (text: string, messageId: string) => Promise<void>;
  clearChat: () => void;
  retryLastMessage: () => void;
}

export function useChatInterfaceState({
  isAgentReady,
  onSendMessage,
}: IChatPanelProps): IUseChatInterfaceStateReturn {
  const [messages, setMessages] = useState<IChatPanelMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { copiedId, copyToClipboard } = useCopyFeedback();
  const sendMessage = useSendMessage({
    input,
    isAgentReady,
    isLoading,
    onSendMessage,
    setInput,
    setIsLoading,
    setMessages,
  });

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void sendMessage();
      }
    },
    [sendMessage],
  );

  const clearChat = useCallback(() => {
    setMessages([]);
  }, []);

  const retryLastMessage = useCallback(() => {
    const lastUserMessage = findLastUserMessage(messages);
    if (!lastUserMessage) return;

    setInput(lastUserMessage.content);
    inputRef.current?.focus();
  }, [messages]);

  return {
    messages,
    input,
    isLoading,
    copiedId,
    inputRef,
    setInput,
    sendMessage,
    handleKeyDown,
    copyToClipboard,
    clearChat,
    retryLastMessage,
  };
}
