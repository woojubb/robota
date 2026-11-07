/**
 * One refresh at a time per credential, across every process that shares the store.
 *
 * Two agent runtime processes signed in to the same server share its stored refresh token. When an
 * authorization server rotates refresh tokens, the second of two concurrent refreshes presents a
 * token the first already spent and is answered `invalid_grant` — which would sign the user out.
 * So a refresh runs under this lock, and whoever holds it re-reads the store first: a token another
 * process refreshed while this one waited is used as it is.
 *
 * The lock is the caller's, not the store's: a store only keeps credentials, and the same lock
 * serves a store that is not a file at all. This entry holds the port; the lock files of
 * `createFileOAuthRefreshLock` on `@robota-sdk/agent-mcp/node` are one implementation of it.
 */

import type { IMCPOAuthCredentialKey } from './store.js';

export interface IMCPOAuthRefreshLock {
  /** Run `critical` while no other holder, in this process or another, runs for the same key. */
  withLock<T>(
    key: IMCPOAuthCredentialKey,
    critical: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>;
}
