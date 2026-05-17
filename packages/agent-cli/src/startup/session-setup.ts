import type { IInteractiveSessionStore } from '@robota-sdk/agent-framework';
import {
  createProjectSessionStore,
  resolveLatestSessionId,
  resolveSessionIdByIdOrName,
} from '@robota-sdk/agent-framework';
import type { ISessionRunOptions } from './args-to-options.js';

export interface ISessionSetup {
  sessionStore: IInteractiveSessionStore | undefined;
  resumeSessionId: string | undefined;
  showSessionPickerOnStart: boolean;
}

export function createSessionSetup(cwd: string, opts: ISessionRunOptions): ISessionSetup {
  const sessionStore = opts.noSessionPersistence ? undefined : createProjectSessionStore(cwd);

  let resumeSessionId: string | undefined;
  let showSessionPickerOnStart = false;

  if (opts.continueMode) {
    resumeSessionId = resolveLatestSessionId(sessionStore, cwd);
  } else if (opts.resumeId !== undefined) {
    if (opts.resumeId === '') {
      showSessionPickerOnStart = true;
    } else {
      resumeSessionId = resolveSessionIdByIdOrName(sessionStore, opts.resumeId);
      if (resumeSessionId === undefined) {
        process.stderr.write(`Session not found: ${opts.resumeId}\n`);
        process.exit(1);
      }
    }
  }

  return { sessionStore, resumeSessionId, showSessionPickerOnStart };
}
