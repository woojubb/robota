/**
 * Hook: build the handleSubmit callback for user input.
 * Handles slash commands, skill commands, and regular prompts.
 *
 * For skills with `context: 'fork'`, creates an isolated subagent session
 * via `createSubagentSession` instead of injecting content into the current session.
 */

import type { Dispatch, SetStateAction } from 'react';
import { useCallback } from 'react';
import { randomUUID } from 'node:crypto';
import type { Session } from '@robota-sdk/agent-sdk';
import {
  createSubagentSession,
  getBuiltInAgent,
  retrieveAgentToolDeps,
} from '@robota-sdk/agent-sdk';
import {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createToolMessage,
} from '@robota-sdk/agent-core';
import type { TUniversalMessage } from '@robota-sdk/agent-core';
import type { CommandRegistry } from '../../commands/command-registry.js';
import { extractToolCallsWithDiff } from '../../utils/tool-call-extractor.js';
import { buildSkillPrompt } from '../../utils/skill-prompt.js';
import { executeSkill } from '../../commands/skill-executor.js';
import type { IForkExecutionOptions } from '../../commands/skill-executor.js';

type TAddMessage = (msg: TUniversalMessage) => void;
type TContextStateSetter = Dispatch<
  SetStateAction<{ percentage: number; usedTokens: number; maxTokens: number }>
>;

/** Snapshot context state from session into React state */
export function syncContextState(session: Session, setter: TContextStateSetter): void {
  const ctx = session.getContextState();
  setter({ percentage: ctx.usedPercentage, usedTokens: ctx.usedTokens, maxTokens: ctx.maxTokens });
}

/** Run a prompt through the session with thinking/streaming state management. Exported for testing. */
export async function runSessionPrompt(
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
    const toolSummaries = extractToolCallsWithDiff(
      history as Array<{
        role: string;
        toolCalls?: Array<{ function: { name: string; arguments: string } }>;
      }>,
      historyBefore,
    );
    if (toolSummaries.length > 0) {
      addMessage(
        createToolMessage(JSON.stringify(toolSummaries), {
          toolCallId: randomUUID(),
          name: `${toolSummaries.length} tools`,
        }),
      );
    }

    addMessage(createAssistantMessage(response || '(empty response)'));
    syncContextState(session, setContextState);
  } catch (err) {
    clearStreamingText();
    if (err instanceof DOMException && err.name === 'AbortError') {
      // Extract tool summaries from history even on abort
      const history = session.getHistory();
      const toolSummaries = extractToolCallsWithDiff(
        history as Array<{
          role: string;
          toolCalls?: Array<{ function: { name: string; arguments: string } }>;
        }>,
        historyBefore,
      );
      if (toolSummaries.length > 0) {
        addMessage(
          createToolMessage(JSON.stringify(toolSummaries), {
            toolCallId: randomUUID(),
            name: `${toolSummaries.length} tools`,
          }),
        );
      }
      // Find the last assistant message from this execution (search backward).
      // May be 'interrupted' (abort during streaming) or 'complete' (abort during tool execution).
      for (let i = history.length - 1; i >= historyBefore; i--) {
        const msg = history[i];
        if (msg && msg.role === 'assistant') {
          addMessage(msg);
          break;
        }
      }
      addMessage(createSystemMessage('Cancelled.'));
    } else {
      const errMsg = err instanceof Error ? err.message : String(err);
      addMessage(createSystemMessage(`Error: ${errMsg}`));
    }
  } finally {
    setIsThinking(false);
  }
}

/**
 * Create a runInFork callback that spawns an isolated subagent session.
 *
 * Retrieves per-session agent tool deps that were stored during session
 * creation (keyed by the Session instance). Returns the subagent's response text.
 */
function createForkRunner(
  sessionKey: Session,
): ((content: string, options: IForkExecutionOptions) => Promise<string>) | undefined {
  const deps = retrieveAgentToolDeps(sessionKey);
  if (!deps) return undefined;

  return async (content: string, options: IForkExecutionOptions): Promise<string> => {
    const agentType = options.agent ?? 'general-purpose';
    // Resolve agent: check built-in first, then custom registry (same pattern as agent-tool.ts)
    const agentDef = getBuiltInAgent(agentType) ?? deps.customAgentRegistry?.(agentType);
    if (!agentDef) {
      throw new Error(`Unknown agent type for fork execution: ${agentType}`);
    }

    // Apply tool filtering from skill's allowedTools
    const effectiveDef = options.allowedTools
      ? { ...agentDef, tools: options.allowedTools }
      : agentDef;

    const subSession = createSubagentSession({
      agentDefinition: effectiveDef,
      parentConfig: deps.config,
      parentContext: deps.context,
      parentTools: deps.tools,
      terminal: deps.terminal,
      isForkWorker: true,
      permissionHandler: deps.permissionHandler,
      onTextDelta: deps.onTextDelta,
      onToolExecution: deps.onToolExecution,
    });

    return await subSession.run(content);
  };
}

/**
 * Find a skill command from the registry by parsing slash command input.
 * Returns the skill command and extracted args, or null if not a skill.
 */
function findSkillCommand(
  input: string,
  registry: CommandRegistry,
): { skill: ReturnType<CommandRegistry['getCommands']>[number]; args: string } | null {
  const parts = input.slice(1).split(/\s+/);
  const cmd = parts[0]?.toLowerCase() ?? '';
  const skillCmd = registry
    .getCommands()
    .find((c) => c.name === cmd && (c.source === 'skill' || c.source === 'plugin'));
  if (!skillCmd) return null;
  return { skill: skillCmd, args: parts.slice(1).join(' ').trim() };
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

        // Find skill command from registry
        const found = findSkillCommand(input, registry);
        if (!found) return;

        const { skill, args } = found;

        // For fork skills, try subagent execution via executeSkill
        if (skill.context === 'fork') {
          const runInFork = createForkRunner(session);
          const result = await executeSkill(skill, args, { runInFork });

          if (result.mode === 'fork') {
            // Fork completed — show the subagent's response
            addMessage(createAssistantMessage(result.result ?? '(empty response)'));
            syncContextState(session, setContextState);
            return;
          }

          // Fell through to inject mode (no deps available)
          // Continue below to handle as inject
          if (result.prompt) {
            const cmdName = input.slice(1).split(/\s+/)[0]?.toLowerCase() ?? '';
            const qualifiedName = registry.resolveQualifiedName(cmdName);
            const hookInput = qualifiedName
              ? `/${qualifiedName}${input.slice(1 + cmdName.length)}`
              : input;

            return runSessionPrompt(
              result.prompt,
              session,
              addMessage,
              clearStreamingText,
              setIsThinking,
              setContextState,
              hookInput,
            );
          }
          return;
        }

        // Non-fork skills: use buildSkillPrompt for inject mode
        // (preserves shell command preprocessing)
        const prompt = await buildSkillPrompt(input, registry);
        if (!prompt) return;

        // For plugin skills, resolve the full qualified name for hook matching
        // e.g., /audit → /rulebased-harness:audit
        const cmdName = input.slice(1).split(/\s+/)[0]?.toLowerCase() ?? '';
        const qualifiedName = registry.resolveQualifiedName(cmdName);
        const hookInput = qualifiedName
          ? `/${qualifiedName}${input.slice(1 + cmdName.length)}`
          : input;

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

      addMessage(createUserMessage(input));
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
