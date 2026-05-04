/**
 * Slash command routing logic for the TUI.
 * Extracted from useInteractiveSession for single-responsibility.
 */

import { useCallback } from 'react';
import { randomUUID } from 'node:crypto';
import type {
  InteractiveSession,
  CommandRegistry,
  ICommandResult,
  TCommandEffect,
} from '@robota-sdk/agent-sdk';
import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import type { TuiStateManager } from '../tui-state-manager.js';
import type { ICommandEffectQueue } from './command-effect-queue.js';
import { reloadPluginCommandSource } from '../../plugins/plugin-command-source-loader.js';

export function useSlashRouting(
  interactiveSession: InteractiveSession,
  registry: CommandRegistry,
  manager: TuiStateManager,
  commandEffectQueue: ICommandEffectQueue,
): (input: string) => Promise<void> {
  return useCallback(
    async (input: string) => {
      manager.onUserTurnAccepted();

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
        applySystemCommandResult(result, interactiveSession, registry, manager, commandEffectQueue);
        return;
      }

      // Try skill/plugin command
      if (await routeSkillCommand(input, cmd, registry, interactiveSession, manager)) {
        return;
      }

      manager.addEntry(
        messageToHistoryEntry(
          createSystemMessage(`Unknown command "/${cmd}". Type /help for help.`),
        ),
      );
    },
    [interactiveSession, registry, manager, commandEffectQueue],
  );
}

export function applySystemCommandResult(
  result: ICommandResult,
  interactiveSession: InteractiveSession,
  registry: CommandRegistry,
  manager: TuiStateManager,
  commandEffectQueue: ICommandEffectQueue,
): void {
  const pendingEffects = applyImmediateCommandEffects(result.effects, registry, manager);
  manager.addEntry(messageToHistoryEntry(createSystemMessage(result.message)));

  if (result.interaction !== undefined) {
    commandEffectQueue.enqueueInteraction(result.interaction);
  }
  if (pendingEffects.length > 0) {
    commandEffectQueue.enqueueEffects(pendingEffects);
  }

  const ctx = interactiveSession.getContextState();
  manager.setContextState({
    percentage: ctx.usedPercentage,
    usedTokens: ctx.usedTokens,
    maxTokens: ctx.maxTokens,
  });
}

function applyImmediateCommandEffects(
  effects: readonly TCommandEffect[] | undefined,
  registry: CommandRegistry,
  manager: TuiStateManager,
): TCommandEffect[] {
  if (effects === undefined || effects.length === 0) return [];
  const pendingEffects: TCommandEffect[] = [];
  for (const effect of effects) {
    if (effect.type === 'conversation-history-cleared') {
      manager.clearHistory();
      continue;
    }
    if (effect.type === 'plugin-registry-reload-requested') {
      reloadPluginCommandSource(registry);
      continue;
    }
    pendingEffects.push(effect);
  }
  return pendingEffects;
}

async function routeSkillCommand(
  input: string,
  cmd: string,
  registry: CommandRegistry,
  interactiveSession: InteractiveSession,
  manager: TuiStateManager,
): Promise<boolean> {
  const skillCmd = registry
    .getCommands()
    .find((c) => c.name === cmd && (c.source === 'skill' || c.source === 'plugin'));
  if (!skillCmd) {
    return false;
  }

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

  const args = input.slice(1 + cmd.length).trimStart();
  const qualifiedName = registry.resolveQualifiedName(cmd);
  const hookInput = qualifiedName ? `/${qualifiedName}${input.slice(1 + cmd.length)}` : input;
  await interactiveSession.executeSkillCommand(skillCmd, args, input, hookInput);
  manager.setPendingPrompt(interactiveSession.getPendingPrompt());
  return true;
}
