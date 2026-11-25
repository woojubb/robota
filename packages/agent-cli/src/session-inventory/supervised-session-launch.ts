import { childProductEnvironment } from '../product/child-environment.js';
import {
  startForwardedRuntime,
  startPlainRuntime,
  startSpawnerRuntime,
  type IRuntimeStartRequest,
  type TPreparedForwardedEnvironment,
} from './runtime-process-launch.js';
import { cliGrantHandoff, cliRuntimeCommand, cliRuntimeLayout } from './runtime-start-layout.js';
import { isSupervisedSessionName } from './supervised-session-control.js';

import type { ChildProcess } from 'node:child_process';
import type { ISpawnerPairResult } from '@robota-sdk/agent-transport/link';

import type { IExternalEventGrant } from '@robota-sdk/agent-interface/transport';

import type { ICliRuntimeContext } from '../product/runtime-context.js';

/** Options common to plain and secure supervised launches. */
export interface ISupervisedLaunchOptions {
  readonly productRuntime: ICliRuntimeContext;
  readonly entrypoint?: string;
  readonly execArgs?: readonly string[];
  /** Explicit sidecar command for a host whose own executable is not the CLI (such as Electron). */
  readonly launchCommand?: { readonly executable: string; readonly args: readonly string[] };
  readonly env?: NodeJS.ProcessEnv;
  readonly name?: string;
  readonly onSpawn?: (child: ChildProcess) => void;
  /** Validated external-event grants the child must open before it reports ready. */
  readonly grants?: readonly IExternalEventGrant[];
  /** Where the child's external-event endpoint listens; required with grants. */
  readonly eventEndpoint?: { readonly port: number; readonly trustedProxies?: readonly string[] };
  readonly root?: string;
  /**
   * Start this workspace's daemon: its control hands the owner the WebSocket URL. The caller
   * hands the transport token over in `transportToken`, never on the command line.
   */
  readonly daemon?: boolean;
  /**
   * The WebSocket transport token the child serves under, 64 lowercase hex characters. It reaches
   * the child only over an extra inherited pipe, never its environment (any program of the same
   * user can read a process's initial environment for as long as it runs), command line or
   * stderr: the child's environment is stripped of both names a token could arrive under.
   */
  readonly transportToken?: string;
  /** Start it Restricted: a person chose to run this untrusted folder without its own configuration. */
  readonly restricted?: boolean;
}

/** The generic launcher's request for the CLI's own runtime: its command, layout, environment and rules. */
function startRequest(options: ISupervisedLaunchOptions): IRuntimeStartRequest {
  return {
    command: cliRuntimeCommand(options),
    layout: cliRuntimeLayout(options),
    environment: options.env ?? childProductEnvironment(options.productRuntime),
    name: options.name,
    daemon: options.daemon,
    restricted: options.restricted,
    transportToken: options.transportToken,
    handoff: cliGrantHandoff(options),
    onSpawn: options.onSpawn,
    validate: () => {
      if (options.name !== undefined && !isSupervisedSessionName(options.name)) {
        throw new Error('Supervised session name is invalid or too long.');
      }
    },
  };
}

/** Start one opt-in supervised runtime without sending credentials through the control channel. */
export async function launchSupervisedSession(
  cwd: string,
  options: ISupervisedLaunchOptions,
): Promise<string> {
  return startPlainRuntime(cwd, startRequest(options));
}

/** Start a secure runtime and receive its spawner key over the inherited pair before readiness. */
export async function launchRuntimeProcess(
  cwd: string,
  options: ISupervisedLaunchOptions & { readonly mode: 'spawner'; readonly pairTimeoutMs?: number },
): Promise<{ readonly id: string } & ISpawnerPairResult> {
  return startSpawnerRuntime(cwd, startRequest(options), { pairTimeoutMs: options.pairTimeoutMs });
}

/** Forward a desktop spawner's inherited pair without reading or certifying it. */
export async function launchForwardedRuntime(
  cwd: string,
  options: ISupervisedLaunchOptions & {
    readonly spawnerFd: number;
    readonly prepareEnvironment?: () => Promise<TPreparedForwardedEnvironment>;
  },
): Promise<string> {
  return startForwardedRuntime(cwd, startRequest(options), {
    spawnerFd: options.spawnerFd,
    prepareEnvironment: options.prepareEnvironment,
  });
}
