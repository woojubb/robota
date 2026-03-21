/**
 * Hook: manage chat messages list.
 */

import { useState, useCallback } from 'react';
import type { IChatMessage } from '../types.js';

let msgIdCounter = 0;
function nextId(): string {
  msgIdCounter += 1;
  return `msg_${msgIdCounter}`;
}

export type TAddMessage = (msg: Omit<IChatMessage, 'id' | 'timestamp'>) => void;

export function useMessages(): {
  messages: IChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<IChatMessage[]>>;
  addMessage: TAddMessage;
} {
  const [messages, setMessages] = useState<IChatMessage[]>([]);
  const addMessage = useCallback((msg: Omit<IChatMessage, 'id' | 'timestamp'>) => {
    setMessages((prev) => [...prev, { ...msg, id: nextId(), timestamp: new Date() }]);
  }, []);
  return { messages, setMessages, addMessage };
}
