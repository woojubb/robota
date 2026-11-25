import { openRegisteredOwnerLink } from './owner-link-client.js';
import { createWorkspaceDaemonProver } from './workspace-daemon-proof.js';

import type { IOwnerHandover } from '@robota-sdk/agent-keyring';
import type { IWorkspaceDaemonCandidate } from './workspace-daemon-proof.js';

const provers = new WeakMap<IOwnerHandover, { root: string; prover: ReturnType<typeof createWorkspaceDaemonProver> }>();

/**
 * Authenticate candidates over the registered owner link using the shared Node host policy. The row
 * type is the caller's, so its call sites keep it on the result; the result carries only the fields
 * the proof established.
 */
export async function proveWorkspaceDaemon<TRow extends IWorkspaceDaemonCandidate>(options: {
  readonly root: string;
  readonly workspace: string;
  readonly candidates: readonly TRow[];
  readonly handover: IOwnerHandover;
  readonly timeoutMs?: number;
}): Promise<(TRow & { readonly generation: string }) | undefined> {
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
  try { return (await attempt.result) as (TRow & { readonly generation: string }) | undefined; }
  finally { await attempt.settled; }
}
