import { createDefaultTransportRegistry } from '../product/robota-plumbing.js';
import { createPersonalUsageReporter, createStoredSessionUsageReporter } from './usage-command.js';

import type {
  IInteractiveSessionStore,
  ISessionDirectory,
} from '@robota-sdk/agent-interface-session';
import type { TDriverId } from '@robota-sdk/agent-interface-session';
import type { TUsageSurface } from '@robota-sdk/agent-interface-analytics';

/** Compose the host-owned report producers into the default WebSocket transport. */
function createDefaultUsageTransportRegistry(
  projectStore: IInteractiveSessionStore,
  projectTrusted: boolean,
  driverId: TDriverId,
  surface: TUsageSurface,
  sessionDirectory: ISessionDirectory | undefined,
): ReturnType<typeof createDefaultTransportRegistry> {
  const admittedProjectStore = projectTrusted ? projectStore : undefined;
  const personalUsageReporter = createPersonalUsageReporter(admittedProjectStore);
  const storedSessionUsageReporter = createStoredSessionUsageReporter(admittedProjectStore);
  return createDefaultTransportRegistry(
    personalUsageReporter,
    storedSessionUsageReporter,
    driverId,
    surface,
    sessionDirectory,
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
  projectStore: IInteractiveSessionStore,
  projectTrusted: boolean,
  open: boolean,
  /** #3189: offered to clients for listing, starting and switching sessions (serve mode only). */
  sessionDirectory?: ISessionDirectory,
  daemon = false,
): ReturnType<typeof createDefaultTransportRegistry> {
  // Read before the registry takes the token out of the environment.
  const { driverId, surface } = resolveCliUsageAttribution({
    desktopToken: Boolean(process.env['ROBOTA_WS_TOKEN']), open, daemon,
  });
  return createDefaultUsageTransportRegistry(projectStore, projectTrusted, driverId, surface, sessionDirectory);
}
