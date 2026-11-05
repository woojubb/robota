import { openRegisteredOwnerLink } from './owner-link-client.js';

import type { IOwnerHandover } from '@robota-sdk/agent-keyring';
import type { ISupervisedSessionRow } from './supervised-session-control.js';

type TWorkspaceDaemon = ISupervisedSessionRow & { readonly generation: string };

/** Prove both the binding and the daemon facts, with one deadline for the entire candidate set. */
export async function proveWorkspaceDaemon(options: {
  readonly root: string;
  readonly workspace: string;
  readonly candidates: readonly TWorkspaceDaemon[];
  readonly handover: IOwnerHandover;
  readonly timeoutMs?: number;
}): Promise<TWorkspaceDaemon | undefined> {
  if (options.candidates.length === 0) return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  try {
    for (const row of options.candidates) {
      if (controller.signal.aborted) throw new Error('Secure daemon proof timed out.');
      try {
        const link = await openRegisteredOwnerLink({ root: options.root, id: row.id, generation: row.generation,
          handover: options.handover, signal: controller.signal });
        const abort = (): void => link.close();
        controller.signal.addEventListener('abort', abort, { once: true });
        try {
          if (controller.signal.aborted) throw new Error('Secure daemon proof timed out.');
          const result = await link.control({ command: 'status', fields: {} });
          if (controller.signal.aborted) throw new Error('Secure daemon proof timed out.');
          if (result.status === 'running' && result.daemon === true && result.cwd === options.workspace &&
              (result.restricted === true) === (row.restricted === true)) return row;
        } finally {
          controller.signal.removeEventListener('abort', abort);
          link.close();
        }
      } catch {
        if (controller.signal.aborted) throw new Error('Secure daemon proof timed out.');
        // A candidate that cannot prove its binding and reported facts is not selected.
      }
    }
    return undefined;
  } finally { clearTimeout(timer); }
}
