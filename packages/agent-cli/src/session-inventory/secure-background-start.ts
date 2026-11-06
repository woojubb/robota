import { createKeyringFileStore } from '@robota-sdk/agent-local-host';
import { openOwnerAtTerminal } from '../secure/owner-at-terminal.js';
import { openSecureTerminal } from '../secure/secure-terminal.js';
import { launchCertifiedRuntime } from './certified-runtime-launch.js';
import { acquireSupervisedDaemonStartLock, resolveSupervisedDirectory } from './supervised-session-control.js';

import type { IOwnerHandover } from '@robota-sdk/agent-keyring';
import type { ISupervisedLaunchOptions } from './supervised-session-launch.js';

/** Open the owner at the terminal before a background runtime is started and certified. */
export async function startSecureBackground(cwd: string, options: Pick<ISupervisedLaunchOptions, 'productRuntime' | 'env' | 'root' | 'name' | 'restricted'> & {
  readonly openOwner?: () => Promise<IOwnerHandover | undefined>;
  readonly launch?: typeof launchCertifiedRuntime;
  readonly lock?: typeof acquireSupervisedDaemonStartLock;
}): Promise<{ readonly id: string; readonly generation: string }> {
  const runtime = options.productRuntime;
  const root = options.root ?? resolveSupervisedDirectory(runtime);
  const owner = await (options.openOwner ?? (() => openOwnerAtTerminal({
    store: createKeyringFileStore({ path: runtime.layout.userPaths.keyring, root: runtime.layout.userRoot }),
    terminal: openSecureTerminal(), purpose: 'start a secure background session',
    report: (message) => process.stderr.write(`${message}\n`),
  })))();
  if (owner === undefined) throw new Error(`Not started: secure mode needs an unlock. Ask the user to run: ${runtime.vocabulary.cliName} session start --background`);
  try {
    const release = await (options.lock ?? acquireSupervisedDaemonStartLock)(cwd, root, { cliName: runtime.vocabulary.cliName });
    try {
      return await (options.launch ?? launchCertifiedRuntime)(cwd, {
        productRuntime: runtime, root, handover: owner,
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.name === undefined ? {} : { name: options.name }),
        ...(options.restricted ? { restricted: true } : {}),
      });
    } finally { release(); }
  } finally { owner.dispose(); }
}
