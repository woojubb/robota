/**
 * CMD-004 Phase 2 (Stage B) — composition-root wiring for host-executed command actions.
 *
 * The session layer executes a command's host actions through `ICommandHostAdapters`; this module
 * owns the CLI-side adapter pieces: the remote-control enable/stop wiring (off the TUI props, onto
 * the adapter — so `/remote-control` works from every surface) and the late-bound TUI-mode
 * `process` adapter (exit/restart delivered through the App's existing signal-driven end-of-life
 * flow).
 */

import type { RemoteControlController } from '../remote-control/index.js';
import type { ICommandHostAdapters, ICommandProcessAdapter } from '@robota-sdk/agent-framework';

/**
 * REMOTE-008 + CMD-004: assemble the `/remote-control` host adapter over the controller — status +
 * trusted-device queries, and the HOST-EXECUTED enable/stop actions returning the user-facing
 * message (pairing QR/link or fail-closed notice) folded into the command result.
 */
export function buildRemoteControlHostAdapter(
  controller: RemoteControlController,
): NonNullable<ICommandHostAdapters['remoteControl']> {
  return {
    getStatus: () => controller.getStatus(),
    listDevices: () =>
      controller.listDevices().map((d) => ({
        deviceId: d.deviceId,
        label: d.label,
        lastSeenAt: d.lastSeenAt,
      })),
    revokeDevice: (deviceId: string) => controller.revokeDevice(deviceId),
    enable: () => controller.enable(),
    stop: () => controller.stop(),
  };
}

/** Delay before delivering the shutdown signal, so the command result renders first. */
const TUI_PROCESS_EXIT_DELAY_MS = 500;

/**
 * The TUI-mode `process` adapter: host-executed exit/restart actions terminate the interactive
 * session through the App's EXISTING end-of-life flow — a deferred SIGTERM drives the registered
 * signal handler (graceful channel shutdown → Ink exit → exit 0), so the terminal is restored and
 * the command result renders before teardown. Restart in the TUI has always meant "graceful exit,
 * user/supervisor relaunches" (the legacy TUI effect handler ran the same requestShutdown for both).
 */
export function createTuiProcessAdapter(): ICommandProcessAdapter {
  const scheduleShutdownSignal = (): void => {
    const timer = setTimeout(() => process.kill(process.pid, 'SIGTERM'), TUI_PROCESS_EXIT_DELAY_MS);
    timer.unref?.();
  };
  return {
    requestExit: () => scheduleShutdownSignal(),
    requestRestart: () => scheduleShutdownSignal(),
  };
}
