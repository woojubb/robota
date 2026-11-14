/**
 * The personal agent's one place that builds conversation stores, and so the one place that states
 * how they seal.
 *
 * The local mode keeps conversations plain inside the owner-private state directory. Sealing them
 * with the keyring, as the CLI's secure mode does, is a separate decision this factory would make
 * for every store at once; no other module builds a store, so none can write plaintext beside
 * sealed files.
 */
import { join } from 'node:path';

import { createUserSessionStore } from '@robota-sdk/agent-framework/node';

import type { IInteractiveSessionStore } from '@robota-sdk/agent-framework';

export function createPersonalSessionStore(stateDir: string): IInteractiveSessionStore {
  return createUserSessionStore(join(stateDir, 'sessions'), { sealing: 'plain' });
}
