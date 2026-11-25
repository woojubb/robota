import {
  SUPERVISED_SPAWNER_PAIR_FLAG,
  SUPERVISED_TRANSPORT_TOKEN_FLAG,
  type IRuntimeStartCommand,
  type IRuntimeStartHandoff,
  type IRuntimeStartLayout,
} from '@robota-sdk/agent-local-host';

import { FORWARDED_ENVIRONMENT_FLAG } from '../startup/forwarded-environment.js';
import { RESTRICTED_WORKSPACE_FLAG } from '../startup/workspace-project-composition.js';
import {
  resolveSelfForkWorkerEntry,
  withInspectorSignalDisabled,
} from '../subagents/self-fork-worker-entry.js';
import {
  discardSupervisedGrantHandoff,
  resolveSupervisedDirectory,
  writeSupervisedGrantHandoff,
} from './supervised-session-control.js';

import type { IExternalEventGrant } from '@robota-sdk/agent-interface/transport';

import type { ICliRuntimeContext } from '../product/runtime-context.js';

/** Where a runtime's external-event endpoint listens, and the proxies it trusts. */
interface ICliEventEndpoint {
  readonly port: number;
  readonly trustedProxies?: readonly string[];
}

/** The product's own executable and entry, or the explicit sidecar command of a host that is not the CLI. */
export function cliRuntimeCommand(options: {
  readonly entrypoint?: string;
  readonly execArgs?: readonly string[];
  readonly launchCommand?: { readonly executable: string; readonly args: readonly string[] };
}): IRuntimeStartCommand {
  const self = resolveSelfForkWorkerEntry();
  return {
    executable: options.launchCommand?.executable ?? self.execPath,
    // Explicitly supplied flags keep the inspector signal closed too.
    execArgs: options.launchCommand
      ? []
      : withInspectorSignalDisabled(options.execArgs ?? self.execArgv ?? []),
    entryArgs:
      options.launchCommand?.args ?? (options.entrypoint ? [options.entrypoint] : self.args),
  };
}

function refusalText(code: string, detail: { readonly grant?: string }): string | undefined {
  switch (code) {
    case 'grant-refused':
      return `grant ${detail.grant}: refused by the session.`;
    case 'events-endpoint-failed':
      return 'External event endpoint could not be served on its port.';
    case 'daemon-no-endpoint':
      return 'The daemon has no WebSocket endpoint; enable the ws transport.';
    default:
      return undefined;
  }
}

/** The arguments the CLI's runtime reads, in the order it reads them, and the names it takes a token from. */
export function cliRuntimeLayout(options: {
  readonly productRuntime: ICliRuntimeContext;
  readonly eventEndpoint?: ICliEventEndpoint;
}): IRuntimeStartLayout {
  const { eventEndpoint } = options;
  return {
    arguments: (facts) => [
      '--serve',
      '--supervised-session-id',
      facts.id,
      ...(facts.name === undefined ? [] : [`--name=${facts.name}`]),
      ...(facts.handoff ? ['--supervised-external-event-grants'] : []),
      ...(facts.transportToken ? [SUPERVISED_TRANSPORT_TOKEN_FLAG] : []),
      ...(facts.spawnerPair ? [SUPERVISED_SPAWNER_PAIR_FLAG] : []),
      ...(facts.forwardedEnvironment ? [FORWARDED_ENVIRONMENT_FLAG] : []),
      ...(facts.daemon ? ['--daemon'] : []),
      ...(facts.restricted ? [RESTRICTED_WORKSPACE_FLAG] : []),
      ...(facts.handoff && eventEndpoint !== undefined
        ? [
            `--external-event-port=${eventEndpoint.port}`,
            ...(eventEndpoint.trustedProxies ?? []).map(
              (proxy) => `--external-event-trusted-proxy=${proxy}`,
            ),
          ]
        : []),
    ],
    transportTokenNames: [
      'PRODUCT_WS_TOKEN',
      `${options.productRuntime.config.identity.envPrefix}WS_TOKEN`,
    ],
    refusalText,
  };
}

/** The grants wait for the child in a private file under the supervised directory; none, no handoff. */
export function cliGrantHandoff(options: {
  readonly productRuntime: ICliRuntimeContext;
  readonly grants?: readonly IExternalEventGrant[];
  readonly eventEndpoint?: ICliEventEndpoint;
  readonly root?: string;
}): IRuntimeStartHandoff | undefined {
  const grants = options.grants ?? [];
  if (grants.length === 0) return undefined;
  const root = (): string => options.root ?? resolveSupervisedDirectory(options.productRuntime);
  return {
    labels: grants.map((grant) => grant.grantId),
    check: () => {
      if (options.eventEndpoint === undefined) {
        throw new Error('External event grants need the port their endpoint listens on.');
      }
    },
    write: (id) => writeSupervisedGrantHandoff(root(), id, grants),
    discard: (id) => discardSupervisedGrantHandoff(root(), id),
  };
}
