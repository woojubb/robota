import { createCliRuntimeContext } from './product/runtime-context.js';
import { cliRuntimeLayout } from './session-inventory/runtime-start-layout.js';
import { resolveSupervisedDirectory } from './session-inventory/supervised-session-control.js';
import { launchCliBroker } from './startup/workspace-root-broker-composition.js';

import type {
  IRuntimeStartLayout,
  TWorkspaceRootBrokerLauncher,
} from '@robota-sdk/agent-local-host';
import type { IProductConfig, TConfigEnvironment } from '@robota-sdk/product-config';

/**
 * The CLI's product layout a desktop needs to open a secure owner link, as plain values: where the
 * product keeps its state, how its runtime is started and what it tells a person. It holds no key,
 * lock, link or proof; the secure steps themselves belong to the host that runs them.
 */
export interface IDesktopSecureLayout {
  /** The product's user-state root. */
  readonly userRoot: string;
  /** The file holding the product's wrapped master key. */
  readonly keyringPath: string;
  /** The directory the product's supervised runtimes register in. */
  readonly supervisedDirectory: string;
  /** How the product's workspace-root broker is run, and the approvals file it serves. */
  readonly broker: {
    readonly historyFile: string;
    readonly launcher: TWorkspaceRootBrokerLauncher;
  };
  /** The copy a refused workspace start lock carries. */
  readonly startLock: { readonly removalHint: string };
  /** The arguments the product's runtime reads, the names it takes a token from and its refusal copy. */
  readonly runtimeLayout: IRuntimeStartLayout;
}

/**
 * Derive the layout for the secure conversation mode, from the same runtime context the CLI's own
 * secure commands use. It reads only its arguments, so the supervised directory follows the runtime
 * directory variable the caller's environment carries. The runtime layout is the one a launch
 * without external-event grants uses.
 */
export function resolveDesktopSecureLayout(options: {
  readonly config: IProductConfig;
  readonly environment: TConfigEnvironment;
}): IDesktopSecureLayout {
  const runtime = createCliRuntimeContext(options.config, options.environment, undefined, 'secure');
  return {
    userRoot: runtime.layout.userRoot,
    keyringPath: runtime.layout.userPaths.keyring,
    supervisedDirectory: resolveSupervisedDirectory(runtime),
    broker: { historyFile: runtime.layout.userPaths.workspaceTrust, launcher: launchCliBroker },
    startLock: { removalHint: `${runtime.vocabulary.cliName} daemon clear-start-lock` },
    runtimeLayout: cliRuntimeLayout({ productRuntime: runtime }),
  };
}
