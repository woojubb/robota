/**
 * Driver-identity contracts (REMOTE-014 E5) and driver-routed command events (CMD-004 Phase 2).
 *
 * SSOT for the co-drive attribution id and the events that are routed/attributed by it. Split from
 * `session-contracts.ts` (which re-consumes these for the session surface and event map).
 */

import type { TCommandUiIntent } from './command-contracts.js';

/**
 * REMOTE-014 E5 co-drive attribution: a stable, SERVER-ASSIGNED id for the driver of an input/turn. It is
 * DISPLAY/ATTRIBUTION ONLY — never an authorization input (the OWNER PRINCIPLE, REMOTE-006, governs
 * authorization; remote == local). Remote = the E3 `deviceId`; local = {@link OWNER_DRIVER_ID}; an
 * agent-wakeup/goal turn = {@link AGENT_DRIVER_ID}.
 */
export type TDriverId = string;

/** The local operator ("owner") driver id — the default for a human turn with no explicit driver. */
export const OWNER_DRIVER_ID: TDriverId = 'owner';
/** The reserved driver id for an autonomous (wakeup/goal/agent-initiated) turn — never the owner. */
export const AGENT_DRIVER_ID: TDriverId = 'agent';

/** REMOTE-014 E5: options for `submit` — carries the SERVER-ASSIGNED driver id for co-drive attribution. */
export interface ISubmitOptions {
  readonly driverId?: TDriverId;
}

/**
 * CMD-004 Phase 2: a command-issued UI intent, emitted as a fire-and-forget `ui_intent` session
 * event. Routed to the REQUESTING surface: `requesterDriverId` is stamped from the command-origin
 * driver id passed into `executeCommand` (the REMOTE-014 E5 server-assigned id for remote surfaces;
 * the active turn's driver only as a fallback for model-invoked commands). Other surfaces ignore it;
 * an intent needs no answer (no parking, no response promise). Serializable.
 */
export interface IUiIntentEvent {
  intent: TCommandUiIntent;
  /** The server-assigned driver id of the surface that issued the command (routing/display-only). */
  requesterDriverId?: TDriverId;
}

/**
 * CMD-004 Phase 2: the session was renamed (host-executed `session-rename` action). Broadcast so
 * every attached surface — including co-driving ones — updates its title. Serializable.
 */
export interface ISessionRenamedEvent {
  name: string;
}
