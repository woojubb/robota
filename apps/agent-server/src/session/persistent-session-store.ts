import { join } from 'node:path';

import { createNodeHostSessionStore } from '@robota-sdk/agent-framework';

import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';

let store: IInteractiveSessionStore | undefined;

export function getPlaygroundSessionStore(): IInteractiveSessionStore {
  if (!store) {
    // SEC-020: the project store ROOT is passed as owned, so a `.robota` an older version left at
    // 0755 is tightened along with the sessions directory inside it.
    const root = join(process.cwd(), '.robota');
    store = createNodeHostSessionStore(join(root, 'sessions'), root);
  }
  return store;
}
