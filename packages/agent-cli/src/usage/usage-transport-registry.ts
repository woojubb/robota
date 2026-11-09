import type { ICliRuntimeContext } from '../product/runtime-context.js';
import { createDefaultTransportRegistry } from '../product/runtime-plumbing.js';
import { createPersonalUsageReporter, createStoredSessionUsageReporter } from './usage-command.js';

import type {
  IInteractiveSessionStore,
  ISessionBinder,
} from '@robota-sdk/agent-interface/session';
import type { IProtocolSession, ISessionMessageHandlerOptions } from '@robota-sdk/agent-transport';
import type { TDriverId } from '@robota-sdk/agent-interface/session';
import type { TUsageSurface } from '@robota-sdk/agent-interface/analytics';
import type { IServeObserverOptions } from '../utils/serve-observer-args.js';

/** Compose the host-owned report producers into the default WebSocket transport. */
function createDefaultUsageTransportRegistry(
  runtime: ICliRuntimeContext,
  projectStore: IInteractiveSessionStore,
  projectTrusted: boolean,
  driverId: TDriverId,
  surface: TUsageSurface,
  sessionBinder: ISessionBinder<IProtocolSession> | undefined,
  settingsReporter: ISessionMessageHandlerOptions['settingsReporter'] | undefined,
  transportToken: string | undefined,
  observer: IServeObserverOptions | undefined,
): ReturnType<typeof createDefaultTransportRegistry> {
  const admittedProjectStore = projectTrusted ? projectStore : undefined;
  const personalUsageReporter = createPersonalUsageReporter(runtime, admittedProjectStore);
  const storedSessionUsageReporter = createStoredSessionUsageReporter(runtime, admittedProjectStore);
  return createDefaultTransportRegistry(
    runtime,
    personalUsageReporter,
    storedSessionUsageReporter,
    driverId,
    surface,
    sessionBinder,
    settingsReporter,
    transportToken,
    observer,
  );
}

/**
 * Who drives this runtime over the transport. A desktop token in the environment marks the desktop
 * app's own sidecar; a daemon is started from any terminal and attached to by any client, so it is
 * labelled like any other served runtime even though its launcher also hands it a token.
 */
export function resolveCliUsageAttribution(options: {
  readonly desktopToken: boolean;
  readonly open: boolean;
  readonly daemon: boolean;
}): { readonly driverId: TDriverId; readonly surface: TUsageSurface } {
  if (options.desktopToken && !options.daemon) return { driverId: 'app', surface: 'desktop-app' };
  if (options.open) return { driverId: 'browser', surface: 'browser' };
  return { driverId: 'remote:ws', surface: 'remote' };
}

/** Resolve the trusted CLI/desktop/browser attribution before constructing the shared transports. */
export function createCliUsageTransportRegistry(
  runtime: ICliRuntimeContext,
  projectStore: IInteractiveSessionStore,
  projectTrusted: boolean,
  open: boolean,
  /** Binds each client to the sessions it lists, starts and switches (serve mode only). */
  sessionBinder?: ISessionBinder<IProtocolSession>,
  daemon = false,
  /** Host-owned read/write for the GUI Settings screen. */
  settingsReporter?: ISessionMessageHandlerOptions['settingsReporter'],
  /** A token handed over outside the environment (a supervised daemon's pipe); never written back to it. */
  transportToken?: string,
  /** The read-only observer listener `--serve --observer-port` opens beside the driver listener. */
  observer?: IServeObserverOptions,
): ReturnType<typeof createDefaultTransportRegistry> {
  // Read before the registry takes the token out of the environment.
  const { driverId, surface } = resolveCliUsageAttribution({
    desktopToken: transportToken !== undefined || Boolean(runtime.environment['PRODUCT_WS_TOKEN']),
    open,
    daemon,
  });
  return createDefaultUsageTransportRegistry(
    runtime,
    projectStore,
    projectTrusted,
    driverId,
    surface,
    sessionBinder,
    settingsReporter,
    transportToken,
    observer,
  );
}
