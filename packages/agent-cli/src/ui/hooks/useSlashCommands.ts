/**
 * Hook: handle slash commands via the extracted slash-executor module.
 */

import { useCallback } from 'react';
import type { Session } from '@robota-sdk/agent-sdk';
import type { IChatMessage } from '../types.js';
import type { CommandRegistry } from '../../commands/command-registry.js';
import { executeSlashCommand as execSlash } from '../../commands/slash-executor.js';

type TAddMessage = (msg: Omit<IChatMessage, 'id' | 'timestamp'>) => void;

const EXIT_DELAY_MS = 500;

export function useSlashCommands(
  session: Session,
  addMessage: TAddMessage,
  setMessages: React.Dispatch<React.SetStateAction<IChatMessage[]>>,
  exit: () => void,
  registry: CommandRegistry,
  pendingModelChangeRef: React.MutableRefObject<string | null>,
  setPendingModelId: React.Dispatch<React.SetStateAction<string | null>>,
): (input: string) => Promise<boolean> {
  return useCallback(
    async (input: string): Promise<boolean> => {
      const parts = input.slice(1).split(/\s+/);
      const cmd = parts[0]?.toLowerCase() ?? '';
      const args = parts.slice(1).join(' ');
      const clearMessages = () => setMessages([]);
      const result = await execSlash(cmd, args, session, addMessage, clearMessages, registry);
      if (result.pendingModelId) {
        pendingModelChangeRef.current = result.pendingModelId;
        setPendingModelId(result.pendingModelId);
      }
      if (result.exitRequested) {
        setTimeout(() => exit(), EXIT_DELAY_MS);
      }
      return result.handled;
    },
    [session, addMessage, setMessages, exit, registry, pendingModelChangeRef, setPendingModelId],
  );
}
