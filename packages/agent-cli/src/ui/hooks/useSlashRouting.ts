/**
 * Slash command routing logic for the TUI.
 * Extracted from useInteractiveSession for single-responsibility.
 */

import { useCallback } from 'react';
import { randomUUID } from 'node:crypto';
import type { InteractiveSession, CommandRegistry, ICommandResult } from '@robota-sdk/agent-sdk';
import {
  createSystemMessage,
  messageToHistoryEntry,
  type TUniversalValue,
} from '@robota-sdk/agent-core';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { TuiStateManager } from '../tui-state-manager.js';
import type { ISideEffects } from './side-effects-types.js';
import { handleProviderCommand } from '../../utils/provider-command.js';
import type { TStatusLineSettingsPatch } from '../../utils/statusline-settings.js';

type TSessionWithEffects = InteractiveSession & ISideEffects;

export function useSlashRouting(
  cwd: string,
  interactiveSession: InteractiveSession,
  registry: CommandRegistry,
  manager: TuiStateManager,
  providerDefinitions: readonly IProviderDefinition[],
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

      if (cmd === 'provider') {
        await routeProviderCommand(cwd, args, interactiveSession, manager, providerDefinitions);
        return;
      }

      // Try system command first
      const result = await interactiveSession.executeCommand(cmd, args);
      if (result) {
        applySystemCommandResult(result, interactiveSession, manager);
        return;
      }

      // Try skill/plugin command
      if (await routeSkillCommand(input, cmd, registry, interactiveSession, manager)) {
        return;
      }

      // TUI-only commands
      if (routeTuiCommand(cmd, interactiveSession)) {
        return;
      }

      manager.addEntry(
        messageToHistoryEntry(
          createSystemMessage(`Unknown command "/${cmd}". Type /help for help.`),
        ),
      );
    },
    [cwd, interactiveSession, registry, manager, providerDefinitions],
  );
}

async function routeProviderCommand(
  cwd: string,
  args: string,
  interactiveSession: InteractiveSession,
  manager: TuiStateManager,
  providerDefinitions: readonly IProviderDefinition[],
): Promise<void> {
  const result = await handleProviderCommand(cwd, args, { providerDefinitions });
  manager.addEntry(messageToHistoryEntry(createSystemMessage(result.message)));
  const providerSwitch = result.data?.providerSwitch;
  if (providerSwitch?.profile) {
    getEffects(interactiveSession)._pendingProviderProfile = providerSwitch.profile;
  }
  const providerSetup = result.data?.providerSetup;
  if (providerSetup !== undefined) {
    getEffects(interactiveSession)._pendingProviderSetup = providerSetup;
  }
}

export function applySystemCommandResult(
  result: ICommandResult,
  interactiveSession: InteractiveSession,
  manager: TuiStateManager,
): void {
  manager.addEntry(messageToHistoryEntry(createSystemMessage(result.message)));
  const data = result.data;
  const effects = getEffects(interactiveSession);

  if (typeof data?.modelId === 'string') {
    effects._pendingModelId = data.modelId;
    return;
  }
  if (typeof data?.language === 'string') {
    effects._pendingLanguage = data.language;
    return;
  }
  if (data?.resetRequested === true) {
    effects._resetRequested = true;
    return;
  }
  if (data?.triggerResumePicker === true) {
    effects._triggerResumePicker = true;
    return;
  }
  if (typeof data?.name === 'string') {
    effects._sessionName = data.name;
    return;
  }
  const statusLinePatch = data?.statuslinePatch as TUniversalValue;
  if (isStatusLineSettingsPatch(statusLinePatch)) {
    effects._statusLinePatch = statusLinePatch;
    return;
  }

  const ctx = interactiveSession.getContextState();
  manager.setContextState({
    percentage: ctx.usedPercentage,
    usedTokens: ctx.usedTokens,
    maxTokens: ctx.maxTokens,
  });
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

function routeTuiCommand(cmd: string, interactiveSession: InteractiveSession): boolean {
  if (cmd === 'exit') {
    getEffects(interactiveSession)._exitRequested = true;
    return true;
  }
  if (cmd === 'plugin') {
    getEffects(interactiveSession)._triggerPluginTUI = true;
    return true;
  }
  return false;
}

function getEffects(interactiveSession: InteractiveSession): TSessionWithEffects {
  return interactiveSession as TSessionWithEffects;
}

function isStatusLineSettingsPatch(value: TUniversalValue): value is TStatusLineSettingsPatch {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value instanceof Date
  ) {
    return false;
  }
  const candidate = value as Record<string, TUniversalValue>;
  return (
    (candidate.enabled === undefined || typeof candidate.enabled === 'boolean') &&
    (candidate.gitBranch === undefined || typeof candidate.gitBranch === 'boolean')
  );
}
