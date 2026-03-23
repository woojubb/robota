/**
 * Hook: manage chat messages list with windowing to prevent memory growth.
 * Only the most recent MAX_RENDERED_MESSAGES are kept in React state.
 */

import type React from 'react';
import { useState, useCallback } from 'react';
import type { IChatMessage } from '../types.js';

/** Max messages kept in React state for rendering */
const MAX_RENDERED_MESSAGES = 100;

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
    setMessages((prev) => {
      const updated = [...prev, { ...msg, id: nextId(), timestamp: new Date() }];
      if (updated.length > MAX_RENDERED_MESSAGES) {
        return updated.slice(-MAX_RENDERED_MESSAGES);
      }
      return updated;
    });
  }, []);
  return { messages, setMessages, addMessage };
}
