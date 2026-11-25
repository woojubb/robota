import { startSecureRuntimeOrExit as startLocalSecureRuntimeOrExit } from '@robota-sdk/agent-local-host';

import { productSecureMode, useProductKeyHolder } from '../product/session-sealing.js';
import { userPaths } from '../product/user-paths.js';
import { optionArgv } from '../utils/option-argv.js';

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
