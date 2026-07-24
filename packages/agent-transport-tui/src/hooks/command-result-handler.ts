/**
 * Renders a system-command result into the TUI state (CMD-004 Phase 2 Stage C).
 *
 * Pure rendering only: host actions were already executed (and stripped from the result) by the
 * session layer, and screen navigation arrives via the requester-routed `ui_intent` session event
 * (`useSideEffects`). The only legacy effects still consumed here are the two notification kinds
 * whose final carriers land in Stage E:
 *
 * - `conversation-history-cleared` — refresh the local transcript immediately;
 * - `plugin-registry-reload-requested` — refresh the local command registry/autocomplete (the
 *   semantic plugin reload already ran host-side inside the command).
 *
 * Every other legacy effect is ignored by design — either host-executed upstream or delivered as a
 * `ui_intent` event.
 */

import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';

import type { TuiStateManager } from '../tui-state-manager.js';
import type { CommandRegistry } from '@robota-sdk/agent-framework';
import type {
  ICommandResult,
  IInteractiveSession,
  TCommandEffect,
} from '@robota-sdk/agent-interface-transport';

export function applySystemCommandResult(
  result: ICommandResult,
  interactiveSession: IInteractiveSession,
  registry: CommandRegistry,
  manager: TuiStateManager,
  reloadPluginCommandSource?: (registry: CommandRegistry) => void,
): void {
  applyNotificationEffects(result.effects, registry, manager, reloadPluginCommandSource);
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

function applyNotificationEffects(
  effects: readonly TCommandEffect[] | undefined,
  registry: CommandRegistry,
  manager: TuiStateManager,
  reloadPluginCommandSource?: (registry: CommandRegistry) => void,
): void {
  if (effects === undefined || effects.length === 0) return;
  for (const effect of effects) {
    if (effect.type === 'conversation-history-cleared') {
      manager.clearHistory();
    } else if (effect.type === 'plugin-registry-reload-requested') {
      reloadPluginCommandSource?.(registry);
    }
    // Anything else: host-executed (already applied + stripped) or a `ui_intent` — nothing to do.
  }
}
