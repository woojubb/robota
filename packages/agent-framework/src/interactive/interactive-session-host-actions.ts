/**
 * CMD-004 Phase 2 (Stage B) — the host-action executor for the `executeCommand` pipeline.
 *
 * Generalizes the proven host-side `provider-hot-swap-requested` block: the SESSION layer (the
 * host) applies a command's host actions via the injected `ICommandHostAdapters` (or directly on
 * the session) BEFORE the command result is returned, so the semantics work on EVERY surface —
 * remote, headless (zero surfaces attached), and the local TUI alike.
 *
 * Stage-B stripping scope: applied HOST ACTIONS are removed from the returned `result.effects`
 * (exactly like hot-swap today, so the TUI's duplicate application becomes a no-op). The four
 * UI-intent effects stay DUAL-CARRIED — the legacy effect remains in `result.effects` (the TUI
 * still renders from it until Stage C) AND the session emits the new `ui_intent` event for
 * non-TUI surfaces. Notification effects (`conversation-history-cleared`,
 * `session-execution-started`) pass through untouched (their final carriers are Stage E).
 *
 * No-fallback: an action whose adapter (or adapter capability) is not wired in the current
 * composition yields an EXPLICIT failure in the command result naming the missing capability —
 * never a silent skip.
 */

import { OWNER_DRIVER_ID } from '@robota-sdk/agent-interface-transport';

import { mapLegacyEffectToHostAction, mapLegacyEffectToUiIntent } from './command-effect-shim.js';
import { formatOrgPolicyViolationMessage } from '../command-api/org-policy/org-policy-loader.js';
import {
  isStatusLineCommandSettingsPatch,
  readStatusLineSettings,
} from '../command-api/statusline/statusline-command-api.js';

import type { ICommandHostAdapters } from '../command-api/host-adapters.js';
import type { IOrgPolicy } from '../command-api/org-policy/org-policy-types.js';
import type { TCommandInvocationSource } from '../commands/index.js';
import type {
  ICommandResult,
  IUiIntentEvent,
  TCommandEffect,
  TCommandHostAction,
  TCommandUiIntent,
  TDriverId,
} from '@robota-sdk/agent-interface-transport';

/** The session-side capabilities the applier needs beyond the plain adapters. */
export interface IHostActionExecutionDeps {
  getAdapters(): ICommandHostAdapters;
  /** Org policy gating provider hot-swaps (a violation REPLACES the command result — pre-existing contract). */
  orgPolicy: IOrgPolicy | null;
  /** Perform the live provider switch (session-owned). */
  switchProvider(profileName: string): Promise<void>;
  /** Execute the session rename directly on the session (the session owns its own name) and broadcast it. */
  renameSession(name: string): void;
}

export interface IHostActionApplication {
  /** The result to return: applied host actions stripped; message extended by action outcomes. */
  result: ICommandResult;
  /** UI intents to emit as `ui_intent` events (legacy dual-carry + `result.uiIntents`). */
  uiIntents: readonly TCommandUiIntent[];
}

/** Explicit no-fallback failure for an action whose executor capability is not wired. */
function missingCapabilityFailure(
  action: TCommandHostAction['type'],
  capability: string,
): ICommandResult {
  return {
    success: false,
    message: `Cannot apply '${action}': ${capability} is not available in this environment.`,
  };
}

function actionErrorFailure(action: TCommandHostAction['type'], error: unknown): ICommandResult {
  const message = error instanceof Error ? error.message : String(error);
  return { success: false, message: `Failed to apply '${action}': ${message}` };
}

const HOST_EXECUTED_EFFECT_TYPES: ReadonlySet<TCommandEffect['type']> = new Set([
  'provider-hot-swap-requested',
  'language-change-requested',
  'settings-reset-requested',
  'session-exit-requested',
  'session-restart-requested',
  'session-renamed',
  'statusline-settings-patch',
  'remote-control-enable-requested',
  'remote-control-stop-requested',
]);

/**
 * Apply a successful command result's host actions in order. On the first failure the whole result
 * becomes that explicit failure (and no UI intent is emitted). A failed command result passes
 * through untouched — its actions were never requested to run.
 */
export async function applyCommandHostActions(
  result: ICommandResult,
  deps: IHostActionExecutionDeps,
): Promise<IHostActionApplication> {
  if (!result.success) return { result, uiIntents: [] };

  const legacyEffects = result.effects ?? [];
  const hostActions: TCommandHostAction[] = [
    ...legacyEffects
      .map(mapLegacyEffectToHostAction)
      .filter((action): action is TCommandHostAction => action !== null),
    ...(result.hostActions ?? []),
  ];
  const uiIntents: TCommandUiIntent[] = [
    ...legacyEffects
      .map(mapLegacyEffectToUiIntent)
      .filter((intent): intent is TCommandUiIntent => intent !== null),
    ...(result.uiIntents ?? []),
  ];

  const appendedMessages: string[] = [];
  for (const action of hostActions) {
    const failure = await applyOneHostAction(action, deps, appendedMessages);
    if (failure) return { result: failure, uiIntents: [] };
  }

  if (hostActions.length === 0 && uiIntents.length === 0) return { result, uiIntents: [] };

  const residualEffects = legacyEffects.filter((e) => !HOST_EXECUTED_EFFECT_TYPES.has(e.type));
  const message =
    appendedMessages.length > 0
      ? [result.message, ...appendedMessages].filter((m) => m.length > 0).join('\n')
      : result.message;
  // The split fields are CONSUMED here: actions were applied; intents are delivered as events.
  const applied: ICommandResult = {
    message,
    success: result.success,
    ...(result.data !== undefined ? { data: result.data } : {}),
    ...(residualEffects.length > 0 ? { effects: residualEffects } : {}),
  };
  return { result: applied, uiIntents };
}

/** Execute one host action; returns a failure result to surface, or `null` on success. */
async function applyOneHostAction(
  action: TCommandHostAction,
  deps: IHostActionExecutionDeps,
  appendedMessages: string[],
): Promise<ICommandResult | null> {
  const adapters = deps.getAdapters();
  try {
    switch (action.type) {
      case 'provider-hot-swap': {
        const { orgPolicy } = deps;
        if (
          orgPolicy?.allowedProviders &&
          !orgPolicy.allowedProviders.includes(action.profileName)
        ) {
          return {
            message: formatOrgPolicyViolationMessage(
              `Provider "${action.profileName}" is not allowed by your organization policy. Allowed: ${orgPolicy.allowedProviders.join(', ')}.`,
              orgPolicy.adminContact,
            ),
            success: false,
          };
        }
        await deps.switchProvider(action.profileName);
        return null;
      }
      case 'language-change': {
        const settings = adapters.settings;
        if (!settings) return missingCapabilityFailure(action.type, 'a settings adapter');
        if (!adapters.process)
          return missingCapabilityFailure(action.type, 'a process adapter (restart)');
        settings.write({ ...settings.read(), language: action.language });
        appendedMessages.push('Restarting...');
        adapters.process.requestRestart('other', 'Language change restart');
        return null;
      }
      case 'settings-reset': {
        const settings = adapters.settings;
        if (!settings?.delete)
          return missingCapabilityFailure(action.type, 'a settings adapter with delete()');
        if (!adapters.process)
          return missingCapabilityFailure(action.type, 'a process adapter (exit)');
        const deleted = settings.delete();
        appendedMessages.push(
          deleted ? 'User settings deleted. Exiting...' : 'No user settings found. Exiting...',
        );
        adapters.process.requestExit('other');
        return null;
      }
      case 'session-exit': {
        if (!adapters.process) return missingCapabilityFailure(action.type, 'a process adapter');
        adapters.process.requestExit(action.reason ?? 'prompt_input_exit');
        return null;
      }
      case 'session-restart': {
        if (!adapters.process) return missingCapabilityFailure(action.type, 'a process adapter');
        adapters.process.requestRestart(action.reason, action.message);
        return null;
      }
      case 'session-rename':
        deps.renameSession(action.name);
        return null;
      case 'statusline-settings-patch': {
        const settings = adapters.settings;
        if (!settings) return missingCapabilityFailure(action.type, 'a settings adapter');
        if (!isStatusLineCommandSettingsPatch(action.patch))
          return actionErrorFailure(action.type, new Error('invalid statusline settings patch'));
        const document = settings.read();
        const next = { ...readStatusLineSettings(document), ...action.patch };
        settings.write({ ...document, statusline: next });
        return null;
      }
      case 'plugin-registry-reload':
        // The semantic reload already ran host-side inside the command (via the plugin adapter);
        // this action kind only exists on the split contract for Stage-E emitters. Nothing to do.
        return null;
      case 'remote-control-enable': {
        const enable = adapters.remoteControl?.enable;
        if (!enable)
          return missingCapabilityFailure(action.type, 'a remote-control adapter with enable()');
        appendedMessages.push(await enable.call(adapters.remoteControl));
        return null;
      }
      case 'remote-control-stop': {
        const stop = adapters.remoteControl?.stop;
        if (!stop)
          return missingCapabilityFailure(action.type, 'a remote-control adapter with stop()');
        appendedMessages.push(await stop.call(adapters.remoteControl));
        return null;
      }
    }
  } catch (error) {
    // No-fallback: an adapter error becomes an explicit failure RESULT — never a silent skip.
    return actionErrorFailure(action.type, error);
  }
}

/**
 * Resolve the `ui_intent` requester: the command-origin driver id passed into `executeCommand`
 * (REMOTE-014 E5 server-assigned rule) wins; a local `'user'` command defaults to the owner; a
 * model-invoked command falls back to the ACTIVE turn's driver (`activeDriverId` is a turn
 * attribute — correct only for that path); a remote command without an injected id stays
 * unattributed (a client-sent id is never trusted).
 */
export function resolveUiIntentRequester(
  source: TCommandInvocationSource,
  originDriverId: TDriverId | undefined,
  activeDriverId: TDriverId | null,
): TDriverId | undefined {
  if (originDriverId !== undefined) return originDriverId;
  if (source === 'model') return activeDriverId ?? undefined;
  return source === 'user' ? OWNER_DRIVER_ID : undefined;
}

/**
 * Emit `ui_intent` events — fire-and-forget, requester-routed. Zero listeners ⇒ no-op (an intent
 * needs no answer — no parking, no response promise, unlike asks).
 */
export function emitUiIntentEvents(
  uiIntents: readonly TCommandUiIntent[],
  requesterDriverId: TDriverId | undefined,
  emit: (event: IUiIntentEvent) => void,
): void {
  for (const intent of uiIntents) {
    emit({ intent, ...(requesterDriverId !== undefined ? { requesterDriverId } : {}) });
  }
}
