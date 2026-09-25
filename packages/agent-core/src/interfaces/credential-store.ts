/**
 * Where a host keeps secrets — private keys, tokens — behind the narrowest interface that can hold
 * them: `get`, `set` and `delete` of a string by key.
 *
 * The contract lives here, in the foundation, so any package that needs a secret kept can take it as
 * an injected port without depending on the host that implements it. How a store keeps secrets (an
 * operating-system keychain, an owner-only file) is the implementation's, and a caller cannot tell
 * which one it was handed. Coordination between readers — one refresh at a time, one creator at a
 * time — belongs to the caller, not to the store, so the same lock serves every backend.
 */

/** A secret's name: the owning service and the account within it, both chosen by the caller. */
export interface ICredentialKey {
  /** A namespace for the caller, e.g. `robota.remote-control`. */
  readonly service: string;
  /** The secret's name within that namespace. */
  readonly account: string;
}

export interface ICredentialStore {
  /** The stored secret, or `undefined` when none is stored. A store that cannot be read throws. */
  get(key: ICredentialKey): Promise<string | undefined>;
  /** Store `secret` under `key`, replacing any secret stored there. */
  set(key: ICredentialKey, secret: string): Promise<void>;
  /** Remove the secret under `key`; removing an absent secret is not an error. */
  delete(key: ICredentialKey): Promise<void>;
}
