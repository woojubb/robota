import {
  KeyHolder,
  createKeyringFileStore,
  holdsNoReadKey,
  startSecureRuntimeOrExit as startLocalSecureRuntimeOrExit,
} from '@robota-sdk/agent-local-host';

import { productSecureMode, useProductKeyHolder } from '../product/session-sealing.js';
import { userPaths } from '../product/user-paths.js';
import { optionArgv } from '../utils/option-argv.js';
import { processSurfaceOf } from './process-surface.js';

import type { IRuntimeIdentity } from '@robota-sdk/agent-keyring';
import type { ISecureServeRuntime } from '@robota-sdk/agent-local-host';
import type { ICliRuntimeContext } from '../product/runtime-context.js';

function hasFlag(options: readonly string[], flag: string): boolean {
  return options.some((argument) => argument === flag || argument.startsWith(`${flag}=`));
}

/**
 * Checks this process's spawner pair against the secure mode of its state root, and gives a secure
 * runtime the key holder its stores seal with, registered as this product's sealing. The options
 * are those before the first `--`, and the option names that say a launch is supervised or serves
 * are this CLI's own.
 */
export function startSecureRuntimeOrExit(
  runtime: ICliRuntimeContext,
  argv: readonly string[],
  identity: IRuntimeIdentity | undefined,
): ISecureServeRuntime | undefined {
  const options = optionArgv(argv);
  const started = startLocalSecureRuntimeOrExit(
    {
      secure: productSecureMode(runtime),
      options,
      supervised: hasFlag(options, '--supervised-session-id'),
      serve: hasFlag(options, '--serve'),
      keyring: { path: userPaths(runtime).keyring, root: runtime.layout.userRoot },
    },
    identity,
  );
  if (started !== undefined) useProductKeyHolder(runtime, started.holder);
  return started;
}

/**
 * Gives a process that is only ever a writer — print mode, `acp`, MCP over stdio, the surfaces the
 * secure table never unlocks — the locked key holder its stores seal with: it holds the sealing
 * public key from the keyring file and no read key, so what it writes opens only for the owner and
 * nothing it runs, or the program that started it, can ask for a secret. Registered before the first
 * workspace composition, which builds a session store.
 *
 * A supervised runtime has its holder already; the terminal, a command and every other invocation get
 * none here. When the keyring file cannot be read there is no key to seal to, so none is registered
 * and the stores refuse as they do for any process without a holder; there is no plaintext fallback.
 */
export function registerLockedKeyHolder(
  runtime: ICliRuntimeContext,
  argv: readonly string[],
  secureRuntime: ISecureServeRuntime | undefined,
): KeyHolder | undefined {
  if (secureRuntime !== undefined || !productSecureMode(runtime)) return undefined;
  const surface = processSurfaceOf(argv, runtime.config.identity.cliName);
  if (surface === undefined || !holdsNoReadKey(surface)) return undefined;
  const holder = new KeyHolder({
    store: createKeyringFileStore({
      path: userPaths(runtime).keyring,
      root: runtime.layout.userRoot,
    }),
  });
  try {
    holder.sealingPublicKey();
  } catch {
    // allow-fallback: without a readable sealing key nothing could be sealed; the stores refuse this process, which is the closed outcome
    return undefined;
  }
  useProductKeyHolder(runtime, holder);
  return holder;
}
