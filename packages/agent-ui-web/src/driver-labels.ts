/**
 * #3289 §3 — plain, human labels for a REMOTE-014 E5 driver id, and whether one is this connection's
 * own. Shared by every place the GUI shows who drove a turn (a message, a permission/ask prompt): the
 * person's own input never carries a label, and a co-driver's does — in words, never a raw id.
 */

import { AGENT_DRIVER_ID, OWNER_DRIVER_ID } from '@robota-sdk/agent-interface-session';

import type { TDriverId } from '@robota-sdk/agent-interface-session';

/**
 * True when `driverId` is either the reserved local-operator id, or (once known) this connection's
 * own server-assigned id — so this connection never labels its own turn as a co-driver's.
 */
export function isOwnDriver(driverId: TDriverId, ownDriverId: TDriverId | null): boolean {
  return driverId === OWNER_DRIVER_ID || (ownDriverId !== null && driverId === ownDriverId);
}

/**
 * A plain noun phrase for who drove a turn that was not this connection's own. Never returns a raw
 * id: an id this function does not recognize still gets the least presumptuous label ("another
 * window") rather than being echoed back.
 */
export function humanDriverLabel(driverId: TDriverId): string {
  if (driverId.startsWith('attach:')) return 'the terminal';
  if (driverId.startsWith('peer:')) return 'a paired device';
  return 'another window';
}

/**
 * The ready-to-render attribution phrase: "from <label>" for a co-driver, or the bare word
 * "automatic" for the agent's own wake-ups — "from automatic" reads as a typo, not a source.
 */
export function driverAttributionText(driverId: TDriverId): string {
  if (driverId === AGENT_DRIVER_ID) return 'automatic';
  return `from ${humanDriverLabel(driverId)}`;
}
