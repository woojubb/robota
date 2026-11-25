import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BrokeredWorkspaceTrustService,
  ensureWorkspaceRootBroker as ensureLocalWorkspaceRootBroker,
} from '@robota-sdk/agent-local-host';

import type { TWorkspaceRootBrokerLauncher } from '@robota-sdk/agent-local-host';
import type { ICliRuntimeContext } from '../product/runtime-context.js';

const START_MS = 5_000;
// Only source CLI startup loads TypeScript in a separate process.
const SOURCE_START_MS = 15_000;

/** Runs this CLI's own binary as the broker: the `--internal-root-broker` entry of `cli-entry`. */
export const launchCliBroker: TWorkspaceRootBrokerLauncher = ({
  endpoint,
  lockDirectory,
  historyFile,
}) => {
  const sourceBin = fileURLToPath(new URL('../bin.ts', import.meta.url));
  const loaderUrl = new URL('../../node_modules/tsx/dist/loader.mjs', import.meta.url);
  const source = existsSync(sourceBin) && existsSync(loaderUrl);
  // The CLI runs under Bun only as a compiled executable. Re-enter its embedded main directly;
  // forwarding Bun's platform-specific virtual entry as a script would turn it into an argument.
  const compiledBun = process.versions.bun !== undefined;
  const script = source
    ? ['--import', loaderUrl.href, '--conditions=product-source', sourceBin]
    : !compiledBun &&
        process.argv[1] !== undefined &&
        existsSync(process.argv[1]) &&
        resolve(process.argv[1]) !== resolve(process.execPath)
      ? [process.argv[1]]
      : [];
  return {
    executable: process.execPath,
    args: [
      ...(source || compiledBun ? [] : process.execArgv),
      ...script,
      '--internal-root-broker',
      endpoint,
      lockDirectory,
      historyFile,
    ],
    startMs: source ? SOURCE_START_MS : START_MS,
  };
};

/** Start this product's workspace-root broker once, or attach to the live one; resolves to its endpoint. */
export function ensureWorkspaceRootBroker(runtime: ICliRuntimeContext): Promise<string> {
  return ensureLocalWorkspaceRootBroker(
    { userRoot: runtime.layout.userRoot, historyFile: runtime.layout.userPaths.workspaceTrust },
    launchCliBroker,
  );
}

/** What the person is told when a broker an older CLI started refuses an operation added since. */
export function staleBrokerMessage(operation: string): string {
  return (
    `The running workspace-root broker is older than this CLI and cannot ${operation}. ` +
    'Restart the workspace-root broker: end its process (started with --internal-root-broker), ' +
    'then run the command again so a current broker starts.'
  );
}

/** The trust service over this product's live broker, laid out by this product's project state directories. */
export function createBrokeredWorkspaceTrust(
  runtime: ICliRuntimeContext,
): Promise<BrokeredWorkspaceTrustService> {
  return BrokeredWorkspaceTrustService.create({
    projectStateDirectories: runtime.layout.projectStateDirectories,
    ensureBroker: () => ensureWorkspaceRootBroker(runtime),
    staleBrokerMessage,
  });
}
