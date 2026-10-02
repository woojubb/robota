/**
 * CMD-004 Stage D — how the GUI surface answers a `ui_intent`.
 *
 * The server requester-routes `ui_intent`, so everything that arrives here was asked for by THIS
 * surface and must be answered visibly. An intent with a GUI screen opens it (the session picker is
 * the session sidebar, #3189; settings and the plugin manager both open the Settings modal, #3282
 * §4a/§4 part b-2; the agent switcher is a sheet, #3282 §4 part b-3). #3282 §4e: an intent whose
 * command is on the GUI's exclusion list never reaches here at all (`excluded-commands.ts` catches it
 * before the session is asked) — this module only answers a screen this HOST cannot back even though
 * the GUI knows how to render it (the session picker, when the host cannot list sessions), or a kind
 * this build does not know at all — and it never says "not available on this surface": each gets its
 * own plain, honest sentence instead.
 */

import { excludedCommandMessage } from './excluded-commands.js';

import type { TCommandUiIntent } from '@robota-sdk/agent-interface-command';

/** The command a user runs for the screen an intent asks for — how the info line is labelled. */
export function uiIntentCommandName(intent: TCommandUiIntent): string {
  switch (intent.type) {
    case 'show-plugin-manager':
      return 'plugin';
    case 'show-settings':
      return 'settings';
    case 'show-session-picker':
      return 'resume';
    case 'show-agent-switcher':
      return 'agent';
    case 'show-theme-picker':
      return 'theme';
    default:
      return (intent as { type: string }).type;
  }
}

/** The GUI screen an intent opens, or null when this surface has none for it. */
export function guiScreenForUiIntent(
  intent: TCommandUiIntent,
): 'session-sidebar' | 'settings' | 'settings-plugins' | 'agent-switcher' | null {
  if (intent.type === 'show-session-picker') return 'session-sidebar';
  if (intent.type === 'show-settings') return 'settings';
  // #3282 §4 part b-2: `/plugin` opens the Settings screen's Plugins section, the way #3331 mapped
  // `show-settings` — replacing the "not available on this surface" line this intent used to get.
  if (intent.type === 'show-plugin-manager') return 'settings-plugins';
  if (intent.type === 'show-agent-switcher') return 'agent-switcher';
  return null;
}

/**
 * Describe one intent for this surface: a plain, honest sentence for a screen this HOST cannot back
 * right now (a session picker with no session list), the `/theme` exclusion this intent defensively
 * reuses, or an unrecognized future kind. Never called for `show-settings`, `show-plugin-manager` or
 * `show-agent-switcher` — all three always have a screen now (#3282 §4a, §4 part b-2, §4 part b-3) —
 * but their cases are left out of this switch rather than kept as dead branches that would claim
 * otherwise; an unknown wire-level kind (a newer host) still yields an explicit notice naming the raw
 * kind, so the "never a silent no-op" floor holds for future intents too.
 */
export function describeUiIntentForGui(intent: TCommandUiIntent): string {
  switch (intent.type) {
    case 'show-session-picker':
      // The GUI knows how to render this screen (`guiScreenForUiIntent` says so); it is only reached
      // here when the HOST itself cannot list sessions, which is this host's limitation, not a
      // missing GUI feature.
      return 'This host cannot list sessions, so there is nothing to resume.';
    case 'show-theme-picker':
      // Defensive only: `/theme` is on the exclusion list and never reaches the session from the GUI.
      return excludedCommandMessage('theme');
    default:
      // Spec-mandated unsupported signal for an intent kind this build does not know (not a
      // fallback: the explicit notice IS the defined behavior for an unrenderable intent).
      return `This client does not have a screen for '${(intent as { type: string }).type}' yet.`;
  }
}
