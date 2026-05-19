import { createProjectSessionStore } from '@robota-sdk/agent-framework';

import type { IInteractiveSessionStore } from '@robota-sdk/agent-framework';

let store: IInteractiveSessionStore | undefined;

export function getPlaygroundSessionStore(): IInteractiveSessionStore {
  if (!store) {
    store = createProjectSessionStore(process.cwd());
  }
  return store;
}
