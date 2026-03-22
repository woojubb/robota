/**
 * Hook: build the handleSubmit callback for user input.
 * Handles slash commands, skill commands, and regular prompts.
 */

import type { Dispatch, SetStateAction } from 'react';
import { useCallback } from 'react';
import type { Session } from '@robota-sdk/agent-sdk';
import type { IChatMessage } from '../types.js';
import type { CommandRegistry } from '../../commands/command-registry.js';
import { extractToolCalls } from '../../utils/tool-call-extractor.js';
import { buildSkillPrompt } from '../../utils/skill-prompt.js';

type TAddMessage = (msg: Omit<IChatMessage, 'id' | 'timestamp'>) => void;
type TContextStateSetter = Dispatch<
  SetStateAction<{ percentage: number; usedTokens: number; maxTokens: number }>
>;

/** Snapshot context state from session into React state */
export function syncContextState(session: Session, setter: TContextStateSetter): void {
  const ctx = session.getContextState();
  setter({ percentage: ctx.usedPercentage, usedTokens: ctx.usedTokens, maxTokens: ctx.maxTokens });
}

/** Run a prompt through the session with thinking/streaming state management */
async function runSessionPrompt(
  prompt: string,
  session: Session,
  addMessage: TAddMessage,
  clearStreamingText: () => void,
  setIsThinking: Dispatch<SetStateAction<boolean>>,
  setContextState: TContextStateSetter,
  rawInput?: string,
): Promise<void> {
  setIsThinking(true);
  clearStreamingText();

  const historyBefore = session.getHistory().length;

  try {
    const response = await session.run(prompt, rawInput);
    clearStreamingText();

    const history = session.getHistory();
    const toolLines = extractToolCalls(
      history as Array<{
        role: string;
        toolCalls?: Array<{ function: { name: string; arguments: string } }>;
      }>,
      historyBefore,
    );
    if (toolLines.length > 0) {
      addMessage({
        role: 'tool',
        content: toolLines.join('\n'),
        toolName: `${toolLines.length} tools`,
      });
    }

    addMessage({ role: 'assistant', content: response || '(empty response)' });
    syncContextState(session, setContextState);
  } catch (err) {
    clearStreamingText();
    if (err instanceof DOMException && err.name === 'AbortError') {
      addMessage({ role: 'system', content: 'Cancelled.' });
    } else {
      const errMsg = err instanceof Error ? err.message : String(err);
      addMessage({ role: 'system', content: `Error: ${errMsg}` });
    }
  } finally {
    setIsThinking(false);
  }
}

export function useSubmitHandler(
  session: Session,
  addMessage: TAddMessage,
  handleSlashCommand: (input: string) => Promise<boolean>,
  clearStreamingText: () => void,
  setIsThinking: Dispatch<SetStateAction<boolean>>,
  setContextState: TContextStateSetter,
  registry: CommandRegistry,
): (input: string) => Promise<void> {
  return useCallback(
    async (input: string) => {
      if (input.startsWith('/')) {
        const handled = await handleSlashCommand(input);
        if (handled) {
          syncContextState(session, setContextState);
          return;
        }
        const prompt = await buildSkillPrompt(input, registry);
        if (!prompt) return;

        // For plugin skills, resolve the full qualified name for hook matching
        // e.g., /audit → /rulebased-harness:audit
        const cmdName = input.slice(1).split(/\s+/)[0]?.toLowerCase() ?? '';
        const matchedCmd = registry
          .getCommands()
          .find((c) => c.name === cmdName && c.source === 'plugin');
        let hookInput = input;
        if (matchedCmd && !input.includes(':')) {
          // Find the corresponding command name (plugin:name format)
          const pluginCommands = registry
            .getCommands()
            .filter(
              (c) =>
                c.source === 'plugin' && c.name.includes(':') && c.name.endsWith(`:${cmdName}`),
            );
          if (pluginCommands.length > 0) {
            hookInput = `/${pluginCommands[0].name}${input.slice(1 + cmdName.length)}`;
          }
        }

        return runSessionPrompt(
          prompt,
          session,
          addMessage,
          clearStreamingText,
          setIsThinking,
          setContextState,
          hookInput,
        );
      }

      addMessage({ role: 'user', content: input });
      return runSessionPrompt(
        input,
        session,
        addMessage,
        clearStreamingText,
        setIsThinking,
        setContextState,
      );
    },
    [
      session,
      addMessage,
      handleSlashCommand,
      clearStreamingText,
      setIsThinking,
      setContextState,
      registry,
    ],
  );
}
