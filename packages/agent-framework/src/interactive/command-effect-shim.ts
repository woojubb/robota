/**
 * CMD-004 Phase 2 (Stage B) — the temporary legacy-effect → split-contract mapping shim.
 *
 * Maps `TCommandEffect` emissions onto `TCommandHostAction` / `TCommandUiIntent` so EVERY existing
 * command gains host execution in Stage B without touching `agent-command`. Stage E migrates the
 * emitters to the split contract and DELETES this module.
 */

import type {
  TCommandEffect,
  TCommandHostAction,
  TCommandUiIntent,
} from '@robota-sdk/agent-interface-transport';

/**
 * Stage-B shim — map a legacy effect to its host action. Returns `null` for effects that are NOT
 * host-executed in Stage B (UI intents, notifications).
 *
 * Shim note (deliberate deviation recorded in the spec's Evidence Log): the spec's classification
 * table lists `plugin-registry-reload-requested` as a host action, but its semantic mutation
 * (`adapter.reloadPlugins()`) ALREADY runs host-side inside `/plugin reload`; the residual effect is
 * only a surface command-registry refresh signal. Mapping it here would DOUBLE-execute the reload
 * (banned), and stripping it would break the TUI's autocomplete refresh before Stage C — so it stays
 * a legacy pass-through until Stage C/E assign its final carrier.
 */
export function mapLegacyEffectToHostAction(effect: TCommandEffect): TCommandHostAction | null {
  switch (effect.type) {
    case 'provider-hot-swap-requested':
      return { type: 'provider-hot-swap', profileName: effect.profileName };
    case 'language-change-requested':
      return { type: 'language-change', language: effect.language };
    case 'settings-reset-requested':
      return { type: 'settings-reset' };
    case 'session-exit-requested':
      return {
        type: 'session-exit',
        ...(effect.reason !== undefined ? { reason: effect.reason } : {}),
        ...(effect.message !== undefined ? { message: effect.message } : {}),
      };
    case 'session-restart-requested':
      return { type: 'session-restart', reason: effect.reason, message: effect.message };
    case 'session-renamed':
      return { type: 'session-rename', name: effect.name };
    case 'statusline-settings-patch':
      return { type: 'statusline-settings-patch', patch: effect.patch };
    case 'remote-control-enable-requested':
      return { type: 'remote-control-enable' };
    case 'remote-control-stop-requested':
      return { type: 'remote-control-stop' };
    default:
      return null;
  }
}

/** Stage-B shim — map a legacy screen-navigation effect to its UI-neutral intent (or `null`). */
export function mapLegacyEffectToUiIntent(effect: TCommandEffect): TCommandUiIntent | null {
  switch (effect.type) {
    case 'plugin-tui-requested':
      return { type: 'show-plugin-manager' };
    case 'settings-tui-requested':
      return { type: 'show-settings' };
    case 'session-picker-requested':
      return { type: 'show-session-picker' };
    case 'agent-switcher-requested':
      return { type: 'show-agent-switcher' };
    default:
      return null;
  }
}
