/**
 * Hook: manage chat messages list with windowing to prevent memory growth.
 * Only the most recent MAX_RENDERED_MESSAGES are kept in React state.
 */

import type React from 'react';
import { useState, useCallback } from 'react';
import type { TUniversalMessage } from '@robota-sdk/agent-core';

/** Max messages kept in React state for rendering */
const MAX_RENDERED_MESSAGES = 100;

export type TAddMessage = (msg: TUniversalMessage) => void;

export function useMessages(): {
  messages: TUniversalMessage[];
  setMessages: React.Dispatch<React.SetStateAction<TUniversalMessage[]>>;
  addMessage: TAddMessage;
} {
  const [messages, setMessages] = useState<TUniversalMessage[]>([]);
  const addMessage = useCallback((msg: TUniversalMessage) => {
    setMessages((prev) => {
      const updated = [...prev, msg];
      if (updated.length > MAX_RENDERED_MESSAGES) {
        return updated.slice(-MAX_RENDERED_MESSAGES);
      }
      return updated;
    });
  }, []);
  return { messages, setMessages, addMessage };
}
