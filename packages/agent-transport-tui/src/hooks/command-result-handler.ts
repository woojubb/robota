/**
 * Renders a system-command result into the TUI state (CMD-004 Phase 2).
 *
 * Pure rendering only: host actions were already executed (and consumed) by the session layer,
 * screen navigation arrives via the requester-routed `ui_intent` session event (`useSideEffects`),
 * and state-change notifications arrive as broadcast session events (`session_renamed`,
 * `history_cleared` — bound in `TuiInteractionChannel`). The only result-carried hint consumed
 * here is `data.pluginRegistryReloaded` — the requester-local command-registry/autocomplete
 * refresh (the semantic plugin reload already ran host-side inside the command).
 */

import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';

import type { TuiStateManager } from '../tui-state-manager.js';
import type { CommandRegistry } from '@robota-sdk/agent-framework';
import type { ICommandResult, IInteractiveSession } from '@robota-sdk/agent-interface-transport';

export function applySystemCommandResult(
  result: ICommandResult,
  interactiveSession: IInteractiveSession,
  registry: CommandRegistry,
  manager: TuiStateManager,
  reloadPluginCommandSource?: (registry: CommandRegistry) => void,
): void {
  if (result.data?.['pluginRegistryReloaded'] === true) {
    reloadPluginCommandSource?.(registry);
  }
  manager.addEntry(messageToHistoryEntry(createSystemMessage(result.message)));

  if (interactiveSession.isInitialized) {
    const ctx = interactiveSession.getContextState();
    manager.setContextState({
      percentage: ctx.usedPercentage,
      usedTokens: ctx.usedTokens,
      maxTokens: ctx.maxTokens,
    });
  }
}
