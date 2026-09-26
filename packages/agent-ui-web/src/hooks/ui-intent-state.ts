/**
 * CMD-004 Stage D — how the GUI surface answers a `ui_intent`.
 *
 * The server requester-routes `ui_intent`, so everything that arrives here was asked for by THIS
 * surface and must be answered visibly. The GUI has no screen for any intent yet, so each one
 * becomes an explicit "not available on this surface" line in the conversation — in place of the
 * command's own "Opening …" reply when this surface's command is awaiting it, at once otherwise (a
 * model-run command, a broadcast) — never a silent drop. When a GUI screen for an intent lands,
 * its arm in {@link describeUiIntentForGui} gives way to that screen.
 */

import type { TCommandUiIntent } from '@robota-sdk/agent-interface-command';

const UNAVAILABLE = 'is not available on this surface. Use the robota terminal on the host.';

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

/**
 * Describe one intent for this surface: the explicit unsupported line (no GUI screen exists for any
 * intent kind yet). An unknown wire-level kind (a newer host) still yields an explicit
 * notice naming the raw kind — the "never a silent no-op" floor holds for future intents too.
 */
export function describeUiIntentForGui(intent: TCommandUiIntent): string {
  switch (intent.type) {
    case 'show-plugin-manager':
      return `The plugin manager ${UNAVAILABLE}`;
    case 'show-settings':
      return `The settings screen ${UNAVAILABLE}`;
    case 'show-session-picker':
      return `The session picker ${UNAVAILABLE}`;
    case 'show-agent-switcher':
      return `The agent switcher ${UNAVAILABLE}`;
    case 'show-theme-picker':
      return `The theme picker ${UNAVAILABLE}`;
    default:
      // Spec-mandated unsupported signal for an intent kind this build does not know (not a
      // fallback: the explicit notice IS the defined behavior for an unrenderable intent).
      return `The screen requested by '${(intent as { type: string }).type}' ${UNAVAILABLE}`;
  }
}
