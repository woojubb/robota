import { useCallback, type Dispatch, type SetStateAction } from 'react';

import {
  createAssistantErrorMessage,
  createAssistantMessage,
  createUserMessage,
} from './message-factory';
import { simulateAgentResponse } from './simulated-response';
import type { IChatPanelMessage, IChatPanelProps } from './types';

interface IUseSendMessageOptions extends IChatPanelProps {
  input: string;
  isLoading: boolean;
  setInput: Dispatch<SetStateAction<string>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<IChatPanelMessage[]>>;
}

export function useSendMessage({
  input,
  isAgentReady,
  isLoading,
  onSendMessage,
  setInput,
  setIsLoading,
  setMessages,
}: IUseSendMessageOptions): () => Promise<void> {
  return useCallback(async () => {
    const userInput = input.trim();
    if (!userInput || !isAgentReady || isLoading) return;

    setMessages((previousMessages) => [...previousMessages, createUserMessage(userInput)]);
    setInput('');
    setIsLoading(true);

    try {
      const response = onSendMessage
        ? await onSendMessage(userInput)
        : await simulateAgentResponse(userInput);
      setMessages((previousMessages) => [...previousMessages, createAssistantMessage(response)]);
    } catch {
      setMessages((previousMessages) => [...previousMessages, createAssistantErrorMessage()]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isAgentReady, isLoading, onSendMessage, setInput, setIsLoading, setMessages]);
}
