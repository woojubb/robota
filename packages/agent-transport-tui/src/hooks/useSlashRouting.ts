/**
 * Slash command routing logic for the TUI.
 * Extracted from useInteractiveSession for single-responsibility.
 */

import { useCallback } from 'react';
import type {
  IInteractiveSession,
  CommandRegistry,
  ICommandResult,
  TCommandEffect,
} from '@robota-sdk/agent-sdk';
import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import type { TuiStateManager } from '../tui-state-manager.js';
import type { ICommandEffectQueue } from './command-effect-queue.js';

export function useSlashRouting(
  interactiveSession: IInteractiveSession,
  registry: CommandRegistry,
  manager: TuiStateManager,
  commandEffectQueue: ICommandEffectQueue,
  reloadPluginCommandSource?: (registry: CommandRegistry) => void,
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
        if (result.effects?.some((effect) => effect.type === 'session-execution-started')) {
          manager.setPendingPrompt(interactiveSession.getPendingPrompt());
          return;
        }
        applySystemCommandResult(
          result,
          interactiveSession,
          registry,
          manager,
          commandEffectQueue,
          reloadPluginCommandSource,
        );
        return;
      }

      manager.addEntry(
        messageToHistoryEntry(
          createSystemMessage(`Unknown command "/${cmd}". Type /help for help.`),
        ),
      );
    },
    [interactiveSession, registry, manager, commandEffectQueue, reloadPluginCommandSource],
  );
}

export function applySystemCommandResult(
  result: ICommandResult,
  interactiveSession: IInteractiveSession,
  registry: CommandRegistry,
  manager: TuiStateManager,
  commandEffectQueue: ICommandEffectQueue,
  reloadPluginCommandSource?: (registry: CommandRegistry) => void,
): void {
  const pendingEffects = applyImmediateCommandEffects(
    result.effects,
    registry,
    manager,
    reloadPluginCommandSource,
  );
  manager.addEntry(messageToHistoryEntry(createSystemMessage(result.message)));

  if (result.interaction !== undefined) {
    commandEffectQueue.enqueueInteraction(result.interaction);
  }
  if (pendingEffects.length > 0) {
    commandEffectQueue.enqueueEffects(pendingEffects);
  }

  if (interactiveSession.isInitialized) {
    const ctx = interactiveSession.getContextState();
    manager.setContextState({
      percentage: ctx.usedPercentage,
      usedTokens: ctx.usedTokens,
      maxTokens: ctx.maxTokens,
    });
  }
}

function applyImmediateCommandEffects(
  effects: readonly TCommandEffect[] | undefined,
  registry: CommandRegistry,
  manager: TuiStateManager,
  reloadPluginCommandSource?: (registry: CommandRegistry) => void,
): TCommandEffect[] {
  if (effects === undefined || effects.length === 0) return [];
  const pendingEffects: TCommandEffect[] = [];
  for (const effect of effects) {
    if (effect.type === 'conversation-history-cleared') {
      manager.clearHistory();
      continue;
    }
    if (effect.type === 'plugin-registry-reload-requested') {
      reloadPluginCommandSource?.(registry);
      continue;
    }
    pendingEffects.push(effect);
  }
  return pendingEffects;
}
