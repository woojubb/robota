/**
 * #3289 §3 — plain, human labels for a REMOTE-014 E5 driver id, and whether one names the SAME KIND
 * of surface as this connection's own. Shared by every place the GUI shows who drove a turn (a
 * message, a permission/ask prompt): the person's own input never carries a label, and a turn from a
 * different kind of surface does — in words, never a raw id.
 *
 * The server hands every WebSocket connection of one `--serve` process the SAME driver id (there is
 * no per-connection id), so two browser tabs of one local page cannot be told apart — and are the
 * same person anyway. A label therefore names the KIND of surface a turn came from (terminal, desktop
 * app, browser, remote device), not a specific window, and is shown only when that kind differs from
 * this window's own.
 */

import { AGENT_DRIVER_ID, OWNER_DRIVER_ID } from '@robota-sdk/agent-interface-session';

import type { TDriverId } from '@robota-sdk/agent-interface-session';

type TSurfaceKind = 'terminal' | 'desktop-app' | 'browser' | 'remote';

/**
 * The kind of surface a driver id names. `null` for an id this function does not recognize — it still
 * gets a label (see `humanDriverLabel`), just not one claimed to match anything else's kind.
 */
function surfaceKindOf(driverId: TDriverId): TSurfaceKind | null {
  if (driverId.startsWith('attach:')) return 'terminal';
  if (driverId === 'app') return 'desktop-app';
  if (driverId === 'browser') return 'browser';
  if (driverId === 'remote:ws' || driverId.startsWith('peer:')) return 'remote';
  return null;
}

/**
 * True when `driverId` names the reserved local-operator id, or a surface of the SAME KIND as this
 * connection's own (once learned) — so this window never labels its own kind of turn as a co-driver's.
 * The agent's own wake-ups (`AGENT_DRIVER_ID`) are never "the same surface": automatic is always
 * labelled, even though no human window could ever learn that as its own id.
 */
export function isSameSurface(driverId: TDriverId, ownDriverId: TDriverId | null): boolean {
  if (driverId === OWNER_DRIVER_ID) return true;
  if (driverId === AGENT_DRIVER_ID) return false;
  if (ownDriverId === null) return false;
  if (driverId === ownDriverId) return true;
  const kind = surfaceKindOf(driverId);
  return kind !== null && kind === surfaceKindOf(ownDriverId);
}

/**
 * A plain noun phrase for the kind of surface that drove a turn which was not this connection's own.
 * Never returns a raw id: an id this function does not recognize still gets the least presumptuous
 * label ("another surface") rather than being echoed back.
 */
export function humanDriverLabel(driverId: TDriverId): string {
  const kind = surfaceKindOf(driverId);
  switch (kind) {
    case 'terminal':
      return 'the terminal';
    case 'desktop-app':
      return 'the desktop app';
    case 'browser':
      return 'the browser';
    case 'remote':
      return 'a remote device';
    default:
      return 'another surface';
  }
}

/**
 * The ready-to-render attribution phrase: "from <label>" for a co-driver, or the bare word
 * "automatic" for the agent's own wake-ups — "from automatic" reads as a typo, not a source.
 */
export function driverAttributionText(driverId: TDriverId): string {
  if (driverId === AGENT_DRIVER_ID) return 'automatic';
  return `from ${humanDriverLabel(driverId)}`;
}
