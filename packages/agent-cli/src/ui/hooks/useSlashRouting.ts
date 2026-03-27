/**
 * Slash command routing logic for the TUI.
 * Extracted from useInteractiveSession for single-responsibility.
 */

import { useCallback } from 'react';
import { randomUUID } from 'node:crypto';
import type { InteractiveSession, CommandRegistry } from '@robota-sdk/agent-sdk';
import { buildSkillPrompt } from '@robota-sdk/agent-sdk';
import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import type { TuiStateManager } from '../tui-state-manager.js';
import type { ISideEffects } from './useInteractiveSession.js';

export function useSlashRouting(
  interactiveSession: InteractiveSession,
  registry: CommandRegistry,
  manager: TuiStateManager,
): (input: string) => Promise<void> {
  return useCallback(
    async (input: string) => {
      if (!input.startsWith('/')) {
        await interactiveSession.submit(input);
        manager.setPendingPrompt(interactiveSession.getPendingPrompt());
        return;
      }

      const parts = input.slice(1).split(/\s+/);
      const cmd = parts[0]?.toLowerCase() ?? '';
      const args = parts.slice(1).join(' ');

      // Try system command first
      const result = await interactiveSession.executeCommand(cmd, args);
      if (result) {
        manager.addEntry(messageToHistoryEntry(createSystemMessage(result.message)));
        const effects = interactiveSession as InteractiveSession & ISideEffects;
        if (result.data?.modelId) {
          effects._pendingModelId = result.data.modelId as string;
          return;
        }
        if (result.data?.language) {
          effects._pendingLanguage = result.data.language as string;
          return;
        }
        if (result.data?.resetRequested) {
          effects._resetRequested = true;
          return;
        }
        if (result.data?.triggerResumePicker) {
          effects._triggerResumePicker = true;
          return;
        }
        if (result.data?.name) {
          effects._sessionName = result.data.name as string;
          return;
        }
        const ctx = interactiveSession.getContextState();
        manager.setContextState({
          percentage: ctx.usedPercentage,
          usedTokens: ctx.usedTokens,
          maxTokens: ctx.maxTokens,
        });
        return;
      }

      // Try skill/plugin command
      const skillCmd = registry
        .getCommands()
        .find((c) => c.name === cmd && (c.source === 'skill' || c.source === 'plugin'));
      if (skillCmd) {
        manager.addEntry({
          id: randomUUID(),
          timestamp: new Date(),
          category: 'event',
          type: 'skill-invocation',
          data: {
            skillName: cmd,
            source: skillCmd.source,
            message: `Invoking ${skillCmd.source}: ${cmd}`,
          },
        });
        const prompt = await buildSkillPrompt(input, registry);
        if (prompt) {
          const qualifiedName = registry.resolveQualifiedName(cmd);
          const hookInput = qualifiedName
            ? `/${qualifiedName}${input.slice(1 + cmd.length)}`
            : input;
          await interactiveSession.submit(prompt, input, hookInput);
          manager.setPendingPrompt(interactiveSession.getPendingPrompt());
          return;
        }
      }

      // TUI-only commands
      if (cmd === 'exit') {
        (interactiveSession as InteractiveSession & ISideEffects)._exitRequested = true;
        return;
      }
      if (cmd === 'plugin') {
        (interactiveSession as InteractiveSession & ISideEffects)._triggerPluginTUI = true;
        return;
      }

      manager.addEntry(
        messageToHistoryEntry(
          createSystemMessage(`Unknown command "/${cmd}". Type /help for help.`),
        ),
      );
    },
    [interactiveSession, registry, manager],
  );
}
