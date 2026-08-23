import { join } from 'node:path';

import { createNodeHostSessionStore } from '@robota-sdk/agent-framework';

import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';

let store: IInteractiveSessionStore | undefined;

export function getPlaygroundSessionStore(): IInteractiveSessionStore {
  if (!store) {
    store = createNodeHostSessionStore(join(process.cwd(), '.robota', 'sessions'));
  }
  return store;
}
