/**
 * What `/unlock` and `/lock` need from the process that holds the keys of secure conversations.
 *
 * The host owns the secret: the passphrase is read on the host's own terminal, inside the handoff
 * the command opens, and never crosses this port. What comes back is a closed outcome and the host's
 * own notices (fingerprints and file paths, which are public), so nothing the command reports can
 * carry what was typed.
 */

/**
 * `unlocked`: the keys are open in this process. `declined`: the person cancelled, or the passphrase
 * did not unlock. `unavailable`: the host could not ask (no terminal it can read a secret from, no
 * keyring).
 */
export type TUnlockOutcome = 'unlocked' | 'declined' | 'unavailable';

export interface IUnlockResult {
  readonly outcome: TUnlockOutcome;
  /** What the person must hear about the keyring itself, such as a sealing key it repaired. */
  readonly notices: readonly string[];
}

export interface IKeyCustodyCommandPort {
  isUnlocked(): boolean;
  /** Ask for the passphrase; called inside the command's terminal handoff. */
  unlock(): Promise<IUnlockResult>;
  /** Drop the keys at once. */
  lock(): void;
}
