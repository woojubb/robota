import { createKeyringFileStore, writeProductConversationMode } from '@robota-sdk/agent-local-host';
import { fixtureKeyring } from '@robota-sdk/agent-local-host/testing';

import { resolveCliRuntimeContext } from '../../startup/product-bootstrap.js';

import type { ICliRuntimeContext } from '../../product/runtime-context.js';

/**
 * Turns secure conversations on in `runtime`'s own state root the way `secure setup` and `secure
 * enable` leave it: the keyring file beside the conversation mode choice. `keyring: false` leaves the
 * file out, which is a state the owner can reach by deleting it; `mode: false` leaves the mode choice
 * out, which is a state after `secure setup` and before `secure enable`.
 */
export async function enableSecureConversations(
  runtime: ICliRuntimeContext,
  options: { readonly keyring?: boolean; readonly mode?: boolean } = {},
): Promise<void> {
  if (options.keyring !== false) {
    const { keyring } = await fixtureKeyring();
    createKeyringFileStore({
      path: runtime.layout.userPaths.keyring,
      root: runtime.layout.userRoot,
    }).create(keyring);
  }
  if (options.mode !== false)
    writeProductConversationMode(runtime.layout.userRoot, 'plain', 'secure');
}

/** The runtime a process started now would resolve for `runtime`'s state root, once it is secure. */
export function resolveSecureRuntime(runtime: ICliRuntimeContext): ICliRuntimeContext {
  return resolveCliRuntimeContext({
    productConfig: runtime.config,
    environment: runtime.environment,
  });
}
