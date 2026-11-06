import { proveWorkspaceDaemon as proveSelectedWorkspaceDaemon } from '@robota-sdk/agent-local-host';
import { openRegisteredOwnerLink } from './owner-link-client.js';

import type { IOwnerHandover } from '@robota-sdk/agent-keyring';
import type { ISupervisedSessionRow } from './supervised-session-control.js';

type TWorkspaceDaemon = ISupervisedSessionRow & { readonly generation: string };

/** Authenticate candidates over the CLI's registered carrier using the shared Node host policy. */
export async function proveWorkspaceDaemon(options: {
  readonly root: string;
  readonly workspace: string;
  readonly candidates: readonly ISupervisedSessionRow[];
  readonly handover: IOwnerHandover;
  readonly timeoutMs?: number;
}): Promise<TWorkspaceDaemon | undefined> {
  return proveSelectedWorkspaceDaemon({ workspace: options.workspace, candidates: options.candidates,
    open: ({ id, generation }, signal) => openRegisteredOwnerLink({ root: options.root, id, generation, handover: options.handover, signal }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
}
