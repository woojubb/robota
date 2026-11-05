import { createKeyringFileStore } from '../secure/keyring-store.js';
import { openOwnerAtTerminal } from '../secure/owner-at-terminal.js';
import { openSecureTerminal } from '../secure/secure-terminal.js';
import { openRegisteredOwnerLink } from './owner-link-client.js';
import { listSupervisedSessions, resolveSupervisedDirectory } from './supervised-session-control.js';

import type { IOwnerHandover } from '@robota-sdk/agent-keyring';
import type { TOwnerControlResult } from '@robota-sdk/agent-transport-link';
import type { ICliRuntimeContext } from '../product/runtime-context.js';

/** Request an owner's control operation only after proving the selected registration. */
export async function secureOwnerControl(options: {
  readonly productRuntime: ICliRuntimeContext;
  readonly root?: string;
  readonly id: string;
  readonly generation?: string;
  readonly command: 'status' | 'rename' | 'link-pr' | 'unlink-pr';
  readonly fields: Readonly<Record<string, string>>;
  readonly openOwner?: () => Promise<IOwnerHandover | undefined>;
}): Promise<TOwnerControlResult> {
  const runtime = options.productRuntime;
  const root = options.root ?? resolveSupervisedDirectory(runtime);
  const rows = await listSupervisedSessions(root, undefined, { includeGeneration: true });
  const row = rows.find((candidate) => candidate.id === options.id && candidate.liveness === 'alive' && candidate.control === 'available');
  if (row?.generation === undefined || (options.generation !== undefined && options.generation !== row.generation)) {
    throw new Error('The selected secure runtime is unavailable or changed.');
  }
  const owner = await (options.openOwner ?? (() => openOwnerAtTerminal({
    store: createKeyringFileStore({ path: runtime.layout.userPaths.keyring, root: runtime.layout.userRoot }),
    terminal: openSecureTerminal(), purpose: `${options.command} on ${options.id}`,
    report: (message) => process.stderr.write(`${message}\n`),
  })))();
  if (owner === undefined) {
    const cli = runtime.vocabulary.cliName;
    const command = options.command === 'status' ? `${cli} session view` :
      `${cli} session ${options.command} ${options.id}${options.command === 'rename' ? ' <name>' : options.command === 'link-pr' ? ' <https-pr-url>' : ''}`;
    throw new Error(`Secure runtime control needs an unlock in an interactive terminal. Ask the user to run: ${command}`);
  }
  try {
    const link = await openRegisteredOwnerLink({ root, id: options.id, generation: row.generation, handover: owner });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([link.control({ command: options.command, fields: options.fields }),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Secure runtime control timed out.')), 10_000); })]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      link.close();
    }
  } finally { owner.dispose(); }
}
