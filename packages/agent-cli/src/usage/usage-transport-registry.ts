import { createDefaultTransportRegistry } from '../product/robota-plumbing.js';
import { createPersonalUsageReporter, createStoredSessionUsageReporter } from './usage-command.js';

import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';
import type { TDriverId } from '@robota-sdk/agent-interface-session';
import type { TUsageSurface } from '@robota-sdk/agent-interface-analytics';

/** Compose the host-owned report producers into the default WebSocket transport. */
function createDefaultUsageTransportRegistry(
  projectStore: IInteractiveSessionStore,
  projectTrusted: boolean,
  driverId: TDriverId,
  surface: TUsageSurface,
): ReturnType<typeof createDefaultTransportRegistry> {
  const admittedProjectStore = projectTrusted ? projectStore : undefined;
  const personalUsageReporter = createPersonalUsageReporter(admittedProjectStore);
  const storedSessionUsageReporter = createStoredSessionUsageReporter(admittedProjectStore);
  return createDefaultTransportRegistry(
    personalUsageReporter,
    storedSessionUsageReporter,
    driverId,
    surface,
  );
}

/** Resolve the trusted CLI/desktop/browser attribution before constructing the shared transports. */
export function createCliUsageTransportRegistry(
  projectStore: IInteractiveSessionStore,
  projectTrusted: boolean,
  open: boolean,
): ReturnType<typeof createDefaultTransportRegistry> {
  const desktop = Boolean(process.env['ROBOTA_WS_TOKEN']);
  return createDefaultUsageTransportRegistry(
    projectStore,
    projectTrusted,
    desktop ? 'app' : open ? 'browser' : 'remote:ws',
    desktop ? 'desktop-app' : open ? 'browser' : 'remote',
  );
}
