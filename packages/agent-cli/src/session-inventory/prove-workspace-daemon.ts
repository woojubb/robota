import { openRegisteredOwnerLink } from './owner-link-client.js';

import type { IOwnerHandover } from '@robota-sdk/agent-keyring';
import type { ISupervisedSessionRow } from './supervised-session-control.js';

type TWorkspaceDaemon = ISupervisedSessionRow & { readonly generation: string };

/** Prove both the binding and the daemon facts, with one deadline for the entire candidate set. */
export async function proveWorkspaceDaemon(options: {
  readonly root: string;
  readonly workspace: string;
  readonly candidates: readonly ISupervisedSessionRow[];
  readonly handover: IOwnerHandover;
  readonly timeoutMs?: number;
}): Promise<TWorkspaceDaemon | undefined> {
  if (options.candidates.length === 0) return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  try {
    let found: TWorkspaceDaemon | undefined;
    for (const row of options.candidates) {
      if (row.liveness === 'dead') continue;
      if (row.liveness !== 'alive' || row.control !== 'available' || row.generation === undefined) {
        throw new Error('An unproven runtime registration prevents secure daemon discovery.');
      }
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
          if (result.status !== 'running' || (result.daemon !== undefined && result.daemon !== true) ||
              (result.daemon === true && typeof result.cwd !== 'string') ||
              (result.restricted !== undefined && result.restricted !== true)) {
            throw new Error('The authenticated runtime returned an incomplete status.');
          }
          if (result.daemon === true && result.cwd === options.workspace && found === undefined) {
            found = { id: row.id, generation: row.generation, liveness: row.liveness, control: row.control,
              activity: row.activity, daemon: true, cwd: options.workspace,
              ...(result.restricted === true ? { restricted: true as const } : {}) };
          }
        } finally {
          controller.signal.removeEventListener('abort', abort);
          link.close();
        }
      } catch {
        if (controller.signal.aborted) throw new Error('Secure daemon proof timed out.');
        throw new Error('An unproven runtime registration prevents secure daemon discovery.');
      }
    }
    return found;
  } finally { clearTimeout(timer); }
}
