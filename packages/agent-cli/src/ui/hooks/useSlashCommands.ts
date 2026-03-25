/**
 * Hook: handle slash commands via the extracted slash-executor module.
 */

import React, { useCallback } from 'react';
import type { Session } from '@robota-sdk/agent-sdk';
import type { TUniversalMessage } from '@robota-sdk/agent-core';
import { createSystemMessage } from '@robota-sdk/agent-core';
import type { CommandRegistry } from '../../commands/command-registry.js';
import { executeSlashCommand as execSlash } from '../../commands/slash-executor.js';
import type { IPluginCallbacks } from '../../commands/slash-executor.js';

const EXIT_DELAY_MS = 500;

export function useSlashCommands(
  session: Session,
  addMessage: (msg: TUniversalMessage) => void,
  setMessages: React.Dispatch<React.SetStateAction<TUniversalMessage[]>>,
  exit: () => void,
  registry: CommandRegistry,
  pendingModelChangeRef: React.MutableRefObject<string | null>,
  setPendingModelId: React.Dispatch<React.SetStateAction<string | null>>,
  pluginCallbacks?: IPluginCallbacks,
  setShowPluginTUI?: React.Dispatch<React.SetStateAction<boolean>>,
): (input: string) => Promise<boolean> {
  return useCallback(
    async (input: string): Promise<boolean> => {
      const parts = input.slice(1).split(/\s+/);
      const cmd = parts[0]?.toLowerCase() ?? '';
      const args = parts.slice(1).join(' ');
      const clearMessages = () => setMessages([]);

      // Adapt TUniversalMessage-based addMessage to slash-executor's plain-object interface.
      // Slash-executor always produces role:'system' messages; map accordingly.
      const slashAddMessage = (msg: { role: string; content: string }): void => {
        addMessage(createSystemMessage(msg.content));
      };

      const result = await execSlash(
        cmd,
        args,
        session,
        slashAddMessage,
        clearMessages,
        registry,
        pluginCallbacks,
      );
      if (result.pendingModelId) {
        pendingModelChangeRef.current = result.pendingModelId;
        setPendingModelId(result.pendingModelId);
      }
      if (result.triggerPluginTUI) {
        setShowPluginTUI?.(true);
      }
      if (result.exitRequested) {
        setTimeout(() => exit(), EXIT_DELAY_MS);
      }
      return result.handled;
    },
    [
      session,
      addMessage,
      setMessages,
      exit,
      registry,
      pendingModelChangeRef,
      setPendingModelId,
      pluginCallbacks,
      setShowPluginTUI,
    ],
  );
}
