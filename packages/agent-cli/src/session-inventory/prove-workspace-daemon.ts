import { createWorkspaceDaemonProver } from '@robota-sdk/agent-local-host';
import { openRegisteredOwnerLink } from './owner-link-client.js';

import type { IOwnerHandover } from '@robota-sdk/agent-keyring';
import type { ISupervisedSessionRow } from './supervised-session-control.js';

type TWorkspaceDaemon = ISupervisedSessionRow & { readonly generation: string };
const provers = new WeakMap<IOwnerHandover, { root: string; prover: ReturnType<typeof createWorkspaceDaemonProver> }>();

/** Authenticate candidates over the CLI's registered carrier using the shared Node host policy. */
export async function proveWorkspaceDaemon(options: {
  readonly root: string;
  readonly workspace: string;
  readonly candidates: readonly ISupervisedSessionRow[];
  readonly handover: IOwnerHandover;
  readonly timeoutMs?: number;
}): Promise<TWorkspaceDaemon | undefined> {
  let held = provers.get(options.handover);
  if (!held) {
    const { root, handover } = options;
    held = { root, prover: createWorkspaceDaemonProver({
      open: ({ id, generation }, signal) => openRegisteredOwnerLink({ root, id, generation, handover, signal }),
    }) };
    provers.set(handover, held);
  }
  if (held.root !== options.root) throw new Error('The owner handover belongs to another daemon proof root.');
  const attempt = held.prover.start({ workspace: options.workspace, candidates: options.candidates,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
  void attempt.failure.then((error) => {
    process.stderr.write(`${error.message} Waiting for owner link shutdown.\n`);
  }).catch(() => {});
  try { return await attempt.result; }
  finally { await attempt.settled; }
}
