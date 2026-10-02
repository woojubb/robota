import type { ICliRuntimeContext } from '../product/runtime-context.js';
/**
 * `/cd` in the TUI (issue #3081): the move is a new the product run in the target directory.
 *
 * Startup already composes everything a session needs from `(cwd, access)` — settings, trust, tools,
 * skills, MCP, instructions — so the move reuses it exactly rather than re-deriving any of it
 * in-process: this adapter saves the conversation copy where the target's session store will find
 * it, lets the TUI end through its normal end-of-life flow, and when this process exits runs the product
 * again in the target directory resuming that copy. The process boundary is what makes the move
 * atomic — no tool call can straddle it.
 */
import { restartProductEnvironment } from '../product/restart-environment.js';
import { spawnSync } from 'node:child_process';

import {
  createRestrictedWorkspaceProjectAccess,
  withUniqueSessionName,
} from '@robota-sdk/agent-framework';

import { resolveSelfForkWorkerEntry } from '../subagents/self-fork-worker-entry.js';
import { buildWorkspaceMoveArgv } from '../utils/cli-args.js';
import { optionArgv } from '../utils/option-argv.js';
import {
  createCliWorkspaceComposition,
  resolveInitialCliWorkspaceProjectAccess,
  SAFE_MODE_FLAG,
} from './workspace-project-composition.js';

import type {
  ICommandWorkspaceAdapter,
  IWorkspaceMoveRequest,
  TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

/**
 * The arguments a `/cd` target starts with keep safe mode on however it was turned on — by the flag,
 * or by an embedder's `startCli({ safeMode: true })`, which leaves no flag in argv.
 */
export function argvCarryingSafeMode(argv: readonly string[], safeMode: boolean): string[] {
  if (!safeMode || optionArgv(argv).includes(SAFE_MODE_FLAG)) return [...argv];
  // Before any `--`: a flag after it would be read as prompt text.
  const terminator = argv.indexOf('--');
  return terminator === -1
    ? [...argv, SAFE_MODE_FLAG]
    : [...argv.slice(0, terminator), SAFE_MODE_FLAG, ...argv.slice(terminator)];
}

export interface IWorkspaceMoveAdapterDeps {
  readonly productRuntime: ICliRuntimeContext;
  readonly providerDefinitions?: readonly IProviderDefinition[];
  readonly userHome: string;
  /** This run's own arguments, carried into the target run minus what to resume. */
  readonly argv: readonly string[];
  /** End the TUI through its normal end-of-life flow. */
  readonly requestExit: () => void;
  /**
   * Variables startup took out of `process.env` (telemetry) and hands back to a the product it starts,
   * so the target run is configured exactly as this one was.
   */
  readonly environment?: Readonly<Record<string, string>>;
  /** Test seams; production uses the trust store, `process.once('exit')` and `spawnSync`. */
  readonly resolveAccess?: (cwd: string) => Promise<TWorkspaceProjectAccess>;
  readonly onProcessExit?: (listener: () => void) => void;
  readonly runSync?: typeof spawnSync;
}

/** A trusted session takes the target's own decision; a Restricted one stays Restricted. */
async function targetAccess(
  request: IWorkspaceMoveRequest,
  resolveAccess: (cwd: string) => Promise<TWorkspaceProjectAccess>,
): Promise<TWorkspaceProjectAccess> {
  if (request.restricted) {
    return createRestrictedWorkspaceProjectAccess('untrusted', request.targetCwd);
  }
  return resolveAccess(request.targetCwd);
}

export function createWorkspaceMoveAdapter(deps: IWorkspaceMoveAdapterDeps): ICommandWorkspaceAdapter {
  const resolveAccess =
    deps.resolveAccess ?? ((cwd: string) => resolveInitialCliWorkspaceProjectAccess(cwd, { productRuntime: deps.productRuntime }));
  const onProcessExit =
    deps.onProcessExit ?? ((listener: () => void) => void process.once('exit', listener));
  const runSync = deps.runSync ?? spawnSync;
  return {
    async move(request) {
      const projectAccess = await targetAccess(request, resolveAccess);
      const target = createCliWorkspaceComposition({
        productRuntime: deps.productRuntime,
        cwd: request.targetCwd,
        userHome: deps.userHome,
        projectAccess,
      });
      const record = withUniqueSessionName(request.record, target.sessionStore);
      target.sessionStore.save(record);
      const args = buildWorkspaceMoveArgv(deps.argv, {
        resumeId: record.id,
        movedFrom: request.fromCwd,
        restricted: projectAccess.status === 'restricted',
      });
      const entry = resolveSelfForkWorkerEntry();
      onProcessExit(() => {
        // Synchronous: an `exit` listener may do nothing else. This process waits for the target
        // run and ends with its status, so a shell or supervisor sees one the product session.
        const result = runSync(entry.execPath, [...(entry.execArgv ?? []), ...entry.args, ...args], {
          cwd: request.targetCwd,
          stdio: 'inherit',
          env: {
            ...restartProductEnvironment(deps.productRuntime, target.settingsSources, deps.providerDefinitions ?? []),
            ...deps.environment,
          },
        });
        process.exitCode = result.status ?? 1;
      });
      deps.requestExit();
    },
  };
}
