/**
 * CMD-004 Stage D — pure `ui_intent` fold for the GUI surface (TC-05).
 *
 * The server requester-routes `ui_intent` (the WS handler forwards an intent only to the surface
 * whose server-assigned driver id issued the command), so everything that arrives here is addressed
 * to THIS surface and must be handled visibly. The GUI presentation core has no full-screen
 * equivalent of the intents today (no settings screen / session picker / plugin manager / agent
 * switcher exists in this package), so v1 folds EVERY intent into an explicit user-visible
 * "not available on this surface" notice — the spec-mandated unsupported signal (LSP
 * `showDocument`-style success/decline), never a silent drop. When a GUI screen for an intent
 * lands, its arm in {@link describeUiIntentForGui} switches from a notice to the mapped surface
 * state. Mirrors `prompt-state.ts` (pure list transition, shared by the WS and RTC clients).
 */

import type { TCommandUiIntent, TDriverId } from '@robota-sdk/agent-interface-transport';
import type { TServerMessage } from '@robota-sdk/agent-transport-protocol';

/** A visible, dismissible entry for a `ui_intent` this surface cannot render as a screen. */
export interface IUiIntentNotice {
  readonly id: string;
  readonly intentType: string;
  /** Explicit user-facing text — names the requested screen and that it is unavailable here. */
  readonly notice: string;
  /** The surface that issued the command (display-only attribution). */
  readonly requesterDriverId?: TDriverId;
}

export type TUiIntentNotice = IUiIntentNotice;

let noticeCounter = 0;
function nextNoticeId(): string {
  return `ui_intent_${++noticeCounter}_${Date.now()}`;
}

const UNAVAILABLE = 'is not available on this surface. Use the robota terminal on the host.';

/**
 * Describe one intent for this surface: the explicit unsupported notice (v1 — no GUI screen exists
 * for any intent kind yet). An unknown wire-level kind (a newer host) still yields an explicit
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
    default:
      // Spec-mandated unsupported signal for an intent kind this build does not know (not a
      // fallback: the explicit notice IS the defined behavior for an unrenderable intent).
      return `The screen requested by '${(intent as { type: string }).type}' ${UNAVAILABLE}`;
  }
}

/**
 * Fold a server message into the notice list: append an explicit entry on `ui_intent`; any other
 * message returns the list unchanged (referential equality preserved).
 */
export function applyUiIntentEvent(
  notices: readonly IUiIntentNotice[],
  msg: TServerMessage,
): readonly IUiIntentNotice[] {
  if (msg.type !== 'ui_intent') return notices;
  const { intent, requesterDriverId } = msg.event;
  return [
    ...notices,
    {
      id: nextNoticeId(),
      intentType: intent.type,
      notice: describeUiIntentForGui(intent),
      ...(requesterDriverId ? { requesterDriverId } : {}),
    },
  ];
}

/** Dismiss one notice by id; an unknown id returns the SAME list reference (idempotent). */
export function removeUiIntentNotice(
  notices: readonly IUiIntentNotice[],
  id: string,
): readonly IUiIntentNotice[] {
  const next = notices.filter((n) => n.id !== id);
  return next.length === notices.length ? notices : next;
}
