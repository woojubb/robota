/**
 * What a device handshake between two of one user's devices establishes about the peer.
 *
 * Trust, locality and workspace are separate axes and are carried separately: a proven same user says
 * nothing about where the peer runs, a peer on this machine proves nothing about whose it is, and a
 * workspace the peer names grants nothing at all. Authority comes only from `trust` and
 * `capabilities`, never from `locality` or `workspace`.
 */

import type { TPeerTrust } from './peer-message-contracts.js';

/** Where a peer runs relative to this session, as the carrier established it. */
export type TPeerReach = 'same-host' | 'another-host';

/** What a peer device may be asked to do: its certificate's capabilities as local policy narrowed them. */
export type TMeshCapability =
  'delegate' | 'drive' | 'file' | 'handoff' | 'message' | 'observe' | 'presence';

/**
 * The result of admitting another of the user's devices. Produced only on success; a refusal is a
 * separate outcome, never an admission with an empty capability set.
 */
export interface IMeshAdmission {
  /**
   * `same-user-same-host` only when the carrier's own kernel-enforced rendezvous established the
   * locality; otherwise `same-user-different-host`. A device certificate proves the user, not the
   * machine.
   */
  readonly trust: Extract<TPeerTrust, 'same-user-same-host' | 'same-user-different-host'>;
  /** Where the carrier established the peer runs. Never an authority input by itself. */
  readonly locality: TPeerReach;
  /** The workspace the peer's signed session descriptor claims. A claim, not a grant. */
  readonly workspace?: string;
  readonly deviceId: string;
  readonly sessionId: string;
  /** Strictly ascending; the intersection of the peer certificate's capabilities and local policy. */
  readonly capabilities: readonly TMeshCapability[];
}
