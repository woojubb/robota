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

import { PeerMessageIngress } from '@robota-sdk/agent-framework';

import { announceLocalPeerPresence } from '../remote-control/local-peer-presence.js';
import { startLocalPeerMessaging } from '../remote-control/local-peer-messaging.js';

import type { ILocalPeerPresence } from '../remote-control/local-peer-presence.js';
import type { IPeerMessaging } from '../remote-control/local-peer-messaging.js';
import type { ITurnHandle } from '@robota-sdk/agent-interface-session';

/** The one session operation peer messaging needs — narrow, so this file cannot grow a second one. */
interface IPeerIngressSession {
  submit(
    input: string,
    displayInput: string | undefined,
    rawInput: string | undefined,
    options: { turnSource: 'peer'; driverId?: string },
  ): Promise<ITurnHandle>;
}

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
 * module-private when `attachHostAdapters` absorbed its only call site — an export nobody
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
 * `attachHostAdapters`, and an export nobody calls is a claim that someone might.
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
): ILocalPeerPresence | undefined {
  try {
    // Generated here, not passed in. A session id identifies THIS process for its whole life and has
    // no other source; asking the caller for one would let two call sites disagree about what a
    // session is, which is the question the registry keys on.
    const presence = announce({ sessionId: randomUUID() });
    adapters.localPeers = buildLocalPeersHostAdapter(presence);
    return presence;
  } catch (error) {
    report.writeError(
      `Local peer discovery is off for this session: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

/**
 * PEER-006: start the listener and fill in `send`, once there is a session to deliver into.
 *
 * Separate from discovery because the two become possible at different moments: a session can be
 * announced before it can run a turn, and announcing late would leave a window where the operator's
 * other session is running and invisible. So `/peers` works from the moment the adapters exist, and
 * `send` appears when there is somewhere for an arriving message to go — which is exactly what the
 * optional `send` on the port is for.
 *
 * A failure here does NOT take discovery down with it. Listing peers and addressing them are
 * different capabilities, and collapsing them would turn a messaging problem into "nobody is there".
 */
export function attachLocalPeerMessaging(
  adapters: ICommandHostAdapters,
  presence: ILocalPeerPresence | undefined,
  getSession: () => IPeerIngressSession,
  report: IAdapterReporter,
  start: typeof startLocalPeerMessaging = startLocalPeerMessaging,
  previous?: Promise<IPeerMessaging | undefined>,
): Promise<IPeerMessaging | undefined> {
  const adapter = adapters.localPeers;
  if (presence === undefined || adapter === undefined) return Promise.resolve(undefined);

  // The PREVIOUS listener is closed before a new one binds. `onChannelReady` fires again on every
  // session switch — render.tsx says so on the call itself — and the socket path is derived from the
  // session id, which does not change. `listenForPeerMessages` unlinks the path before binding, so a
  // second bind SUCCEEDS and the first server is simply orphaned: a listener and its fd per switch,
  // leaking silently because nothing errors.
  return closeQuietly(previous, report).then(() =>
    startMessaging(adapter, presence, getSession, report, start),
  );
}

/** Close a prior listener without letting its failure block the new one. */
async function closeQuietly(
  previous: Promise<IPeerMessaging | undefined> | undefined,
  report: IAdapterReporter,
): Promise<void> {
  if (previous === undefined) return;
  try {
    await (await previous)?.close();
  } catch (error) {
    // A listener that cannot be closed is worth saying out loud — it is the leak this guard exists
    // to prevent — but it must not stop the new one from binding, or a single bad close would end
    // peer messaging for the rest of the process.
    report.writeError(
      `A previous local peer listener could not be closed: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function startMessaging(
  adapter: NonNullable<ICommandHostAdapters['localPeers']>,
  presence: ILocalPeerPresence,
  getSession: () => IPeerIngressSession,
  report: IAdapterReporter,
  start: typeof startLocalPeerMessaging,
): Promise<IPeerMessaging | undefined> {
  return start({
    guardedDirectory: presence.guardedDirectory,
    sessionId: presence.sessionId,
    list: () => presence.list(),
    report: (message) => report.writeError(message),
    ingress: new PeerMessageIngress({
      // The driver id is NOT taken from the arriving message: the messaging leaf derives it from the
      // sender's session id before this is reached, and issue #1809 fixed that a peer must not pick
      // the name a transcript's reader trusts.
      submit: (input, origin) =>
        getSession().submit(input, undefined, undefined, {
          turnSource: 'peer',
          ...(origin.driverId !== undefined ? { driverId: origin.driverId } : {}),
        }),
    }),
  }).then(
    (messaging) => {
      adapter.send = async (targetSessionId, text) => {
        const ack = await messaging.send(targetSessionId, text);
        return { state: ack.state, ...(ack.reason !== undefined ? { reason: ack.reason } : {}) };
      };
      return messaging;
    },
    (error: unknown) => {
      report.writeError(
        `Local peer messaging is off for this session, though discovery is on: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    },
  );
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
export function attachHostAdapters(
  adapters: ICommandHostAdapters,
  controller: RemoteControlController,
  report: IAdapterReporter,
  announce?: (options: { sessionId: string }) => ILocalPeerPresence,
): (channel: { getSession(): IPeerIngressSession }) => void {
  adapters.remoteControl = buildRemoteControlHostAdapter(controller);
  const presence = attachLocalPeerDiscovery(adapters, report, announce);
  // Returns the ACTIVATOR rather than the presence, so the composition root names one thing and
  // never learns what messaging needs from it.
  //
  // The handle is carried across calls because channel-ready fires AGAIN on every session switch.
  // Threading it here rather than inside the attach keeps that state owned by the thing whose
  // lifetime it matches — one activator per process — instead of a module-level variable.
  let running: Promise<IPeerMessaging | undefined> | undefined;
  return (channel) => {
    running = attachLocalPeerMessaging(
      adapters,
      presence,
      () => channel.getSession(),
      report,
      startLocalPeerMessaging,
      running,
    );
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
