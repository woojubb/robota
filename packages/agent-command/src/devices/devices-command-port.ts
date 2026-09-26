/**
 * What `/devices` needs from the host that keeps this device's identity.
 *
 * The host owns every secret: the recovery phrase is shown and read on the host's own terminal, and
 * private keys live in its credential store. What crosses this port back to the command is ids,
 * names, times and closed refusal reasons — nothing the command formats can carry a secret, because
 * the command never receives one. A thrown error's message is the host's promise to the same effect.
 */

export interface IDeviceListEntry {
  readonly deviceId: string;
  readonly name: string;
  readonly thisDevice: boolean;
  /** Whether this entry is known to hold the device-signing key. Only known for this device. */
  readonly holdsSigningKey: boolean;
  readonly certificateExpiresAt: number;
}

export interface IDevicesView {
  readonly userId: string;
  readonly devices: readonly IDeviceListEntry[];
  readonly revokedDeviceCount: number;
  /** When the roster and revocation list this device holds stop being accepted. */
  readonly listsExpireAt: number;
}

/** Why an operation did not happen. Closed, so no free text from the secret path reaches a result. */
export type TDevicesRefusal =
  /** No interactive terminal: the phrase is never shown on or read from anything else. */
  | 'no-terminal'
  | 'not-initialized'
  | 'already-initialized'
  /** The operator cancelled at the terminal. */
  | 'cancelled'
  /** The re-typed words or passphrase did not match. */
  | 'confirmation-failed'
  | 'phrase-invalid'
  /** The phrase is valid but derives another identity than this device's. */
  | 'phrase-mismatch'
  | 'no-signing-key'
  | 'signing-key-expired'
  | 'unknown-device'
  | 'ambiguous-device'
  | 'self-revocation'
  /** Another process changed the identity while this operation waited on the operator. */
  | 'changed-concurrently'
  /** No signaling relay is configured to meet the other device through. */
  | 'no-relay'
  /** What was typed is not an enrollment code. */
  | 'code-invalid'
  /** The code was typed on the command line, where history keeps it. */
  | 'code-on-command-line'
  /** No device waits for that code or proved it: wrong, expired, already used, or something in between. */
  | 'code-not-accepted'
  /** Nobody joined before the code expired. */
  | 'enrollment-expired'
  /** Too many attempts failed to prove the code; it no longer works. */
  | 'too-many-attempts'
  /** The operator of either device declined. */
  | 'enrollment-declined'
  /** An operator did not answer in time. */
  | 'enrollment-timed-out'
  /** The connection or the exchange with the other device failed partway. */
  | 'enrollment-failed';

export type TDevicesOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: TDevicesRefusal };

export interface IDevicesInitResult {
  readonly userId: string;
  readonly deviceId: string;
  readonly signingKeyId: string;
  /** Where the private keys were kept, for the operator. */
  readonly keyStorage?: string;
}

export interface IDevicesRecoverResult {
  readonly deviceId: string;
  readonly signingKeyId: string;
  readonly revokedSigningKeyCount: number;
  /** Other devices that were certified by a retired signing key and must enrol again. */
  readonly droppedDeviceCount: number;
}

export interface IDevicesRevokeResult {
  readonly deviceId: string;
  readonly name: string;
}

export interface IDevicesAddResult {
  readonly deviceId: string;
  readonly name: string;
  /** Whether the new device said it kept what it was given. */
  readonly confirmed: boolean;
}

export interface IDevicesJoinResult {
  readonly userId: string;
  readonly deviceId: string;
  readonly name: string;
  /** Where the private keys were kept, for the operator. */
  readonly keyStorage?: string;
}

export interface IDevicesCommandPort {
  /** This device's view of the roster, or `undefined` when it has no identity yet. */
  list(): Promise<IDevicesView | undefined>;
  /** Create the identity. Runs on the operator terminal (it shows the phrase once). */
  init(options: { readonly name?: string }): Promise<TDevicesOutcome<IDevicesInitResult>>;
  /** Rotate the signing key from the phrase. Runs on the operator terminal. */
  recover(): Promise<TDevicesOutcome<IDevicesRecoverResult>>;
  /** Revoke a device by id prefix with the signing key. Confirms on the operator terminal. */
  revoke(deviceIdPrefix: string): Promise<TDevicesOutcome<IDevicesRevokeResult>>;
  /**
   * Enrol another device with the signing key: show a one-time code, and certify the device that
   * proves it once both operators confirm the string both devices show. Runs on the operator terminal.
   */
  add(): Promise<TDevicesOutcome<IDevicesAddResult>>;
  /**
   * Join the user's devices with a code another device shows, once both operators confirm the string
   * both devices show. Runs on the operator terminal.
   */
  join(options: { readonly name?: string }): Promise<TDevicesOutcome<IDevicesJoinResult>>;
}
