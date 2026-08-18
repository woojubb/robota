/**
 * CMD-004 Phase 2 (Stage B) — composition-root wiring for host-executed command actions.
 *
 * The session layer executes a command's host actions through `ICommandHostAdapters`; this module
 * owns the CLI-side adapter pieces: the remote-control enable/stop wiring (off the TUI props, onto
 * the adapter — so `/remote-control` works from every surface) and the late-bound TUI-mode
 * `process` adapter (exit/restart delivered through the App's existing signal-driven end-of-life
 * flow).
 */

import { randomUUID } from 'node:crypto';

import { announceLocalPeerPresence } from '../remote-control/local-peer-presence.js';

import type { ILocalPeerPresence } from '../remote-control/local-peer-presence.js';

/**
 * Where an adapter reports a capability it could not assemble.
 *
 * The OBJECT, not a bare function. An unbound `terminal.writeError` loses its receiver, and it would
 * do so at the one moment it is needed — while reporting a failure — which is the worst place for a
 * method to be missing its `this`. Calling it on its owner makes that unrepresentable rather than
 * merely avoided.
 */
interface IAdapterReporter {
  writeError(message: string): void;
}
import type { RemoteControlController } from '../remote-control/index.js';
import type { ICommandHostAdapters, ICommandProcessAdapter } from '@robota-sdk/agent-framework';

/**
 * REMOTE-008 + CMD-004: assemble the `/remote-control` host adapter over the controller. Made
 * module-private when `attachCommandHostAdapters` absorbed its only call site — an export nobody
 * calls is a claim that someone might — status +
 * trusted-device queries, and the HOST-EXECUTED enable/stop actions returning the user-facing
 * message (pairing QR/link or fail-closed notice) folded into the command result.
 */
function buildRemoteControlHostAdapter(
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

/**
 * PEER-004 (#1863): the `/peers` adapter over the presence leaf. Module-private — it is a step of
 * `attachCommandHostAdapters`, and an export nobody calls is a claim that someone might.
 *
 * Thin on purpose. The guarded directory, its permissions and the liveness rule all belong to the
 * presence leaf; passing them through would give a second module an opinion about them, and the
 * whole argument for treating an entry as same-user-same-host rests on there being exactly one.
 */
function buildLocalPeersHostAdapter(
  presence: ILocalPeerPresence,
): NonNullable<ICommandHostAdapters['localPeers']> {
  return {
    list: () => presence.list(),
    ownSessionId: () => presence.sessionId,
  };
}

/**
 * PEER-004: announce this session, or say why it is not announced — and never both silently.
 *
 * A refused rendezvous does not stop the session. Discovery is an optional capability, so the
 * failure is REPORTED and the adapter is left unset; `/peers` then says the feature is unavailable
 * rather than claiming nobody is there. Those are different facts, and the difference is what the
 * operator acts on: "nobody is there" invites starting a second session, and this does not.
 *
 * The policy lives here rather than at the composition root because the root is at its frozen size
 * and, more to the point, deciding what a refused rendezvous MEANS is adapter assembly — the same
 * judgement the two functions above make about their own capabilities.
 */
function attachLocalPeerDiscovery(
  adapters: ICommandHostAdapters,
  report: IAdapterReporter,
  announce: (options: { sessionId: string }) => ILocalPeerPresence = announceLocalPeerPresence,
): void {
  try {
    // Generated here, not passed in. A session id identifies THIS process for its whole life and has
    // no other source; asking the caller for one would let two call sites disagree about what a
    // session is, which is the question the registry keys on.
    adapters.localPeers = buildLocalPeersHostAdapter(announce({ sessionId: randomUUID() }));
  } catch (error) {
    report.writeError(
      `Local peer discovery is off for this session: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Assemble every host adapter this shell provides, in one call.
 *
 * The composition root asks for the adapters; this module knows how to build them. Adding a
 * capability there had it grow a line per adapter, and `cli.ts` is frozen debt that may shrink and
 * never grow — the ratchet's answer to that is "split instead of extending", and this is the split:
 * the root keeps one line, and the knowledge of what an adapter needs stays where the other two
 * already keep it.
 */
export function attachCommandHostAdapters(
  adapters: ICommandHostAdapters,
  controller: RemoteControlController,
  report: IAdapterReporter,
  announce?: (options: { sessionId: string }) => ILocalPeerPresence,
): void {
  adapters.remoteControl = buildRemoteControlHostAdapter(controller);
  attachLocalPeerDiscovery(adapters, report, announce);
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
