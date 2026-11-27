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

import { withOwedRedactions } from './owed-redactions.js';

import type { IInteractiveSessionStore } from '@robota-sdk/agent-framework';
import type { IOwedRedactions } from './owed-redactions.js';

/**
 * The chats' store. A session this process runs passes `owed`, so that what a forget still owes it is
 * removed from each record it saves; a reader that only looks at records leaves it out.
 */
export function createPersonalSessionStore(
  stateDir: string,
  owed?: IOwedRedactions,
): IInteractiveSessionStore {
  const store = createUserSessionStore(join(stateDir, 'sessions'), { sealing: 'plain' });
  return owed === undefined ? store : withOwedRedactions(store, owed);
}

/**
 * Where goal runs keep their transcripts: the audit of what the agent did while the person was away.
 * Kept apart from the chats, so a run never appears in the chat list as a chat to continue.
 */
export function createPersonalGoalSessionStore(
  stateDir: string,
  owed?: IOwedRedactions,
): IInteractiveSessionStore {
  const store = createUserSessionStore(join(stateDir, 'goal-sessions'), { sealing: 'plain' });
  return owed === undefined ? store : withOwedRedactions(store, owed);
}
