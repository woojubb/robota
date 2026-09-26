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
import { homedir } from 'node:os';

import { DEFAULT_MAX_FILE_BYTES } from '@robota-sdk/agent-transport/node';

import { createHostCredentialStore } from '../credentials/select-credential-store.js';
import { createHandoffComposition } from '../handoff/handoff-composition-root.js';
import {
  createHandoffHostAdapter,
  describeHandoffArrival,
  localHandoffArrival,
  readHandoffIdentity,
  type IHandoffSourceSession,
} from '../handoff/handoff-host-adapter.js';
import { createHandoffReceiver } from '../handoff/handoff-receiving.js';
import { prepareOutgoingFile } from '../peer-files/outgoing-file.js';
import { formatRobotaResumeCommand } from '../product/robota-command-vocabulary.js';
import { userLocalStorageRoot } from '../product/user-paths.js';

import { announceLocalPeerPresence } from '../remote-control/local-peer-presence.js';
import { bindLocalPeerStatus } from '../remote-control/local-peer-status.js';
import { startLocalPeerMessaging } from '../remote-control/local-peer-messaging.js';
import { sessionPeerIngress, type IPeerIngressSession } from '../remote-control/peer-ingress.js';

import type { IDeviceMeshHost } from '../devices/device-mesh-host.js';
import type { ILocalPeerPresence } from '../remote-control/local-peer-presence.js';
import type {
  IPeerFileReceiving,
  IPeerMessaging,
  IPeerMessagingOptions,
} from '../remote-control/local-peer-messaging.js';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';

/** What `/peers` and `/handoff` use of the device mesh. */
type TMeshPeers = Pick<
  IDeviceMeshHost,
  'bind' | 'devices' | 'handoff' | 'isLinked' | 'send' | 'sendFile'
>;

function isObservableSession(session: IPeerIngressSession): session is IPeerIngressSession & {
  getLocalActivityStatus(): 'working' | 'needs-input' | 'idle' | undefined;
} {
  const candidate = session as IPeerIngressSession & { getLocalActivityStatus?: () => unknown };
  return typeof candidate.getLocalActivityStatus === 'function';
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
    describeKeyStorage: () => controller.describeKeyStorage(),
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
  mesh: TMeshPeers | undefined,
): NonNullable<ICommandHostAdapters['localPeers']> {
  return {
    list: () => presence.list(),
    listWithWorkspace: () => presence.listWithWorkspace(),
    ownSessionId: () => presence.sessionId,
    // A linked device is addressable from the start; sessions here once local messaging is up.
    ...(mesh !== undefined
      ? { listDevices: () => mesh.devices(), ...peerRoutes(undefined, mesh) }
      : {}),
  };
}

type TPeerRoutes = Required<
  Pick<NonNullable<ICommandHostAdapters['localPeers']>, 'send' | 'prepareFile'>
>;

/**
 * `send` and `prepareFile` over whichever carrier reaches the target: a linked device's mesh link, or
 * the local listener for a session on this host.
 */
function peerRoutes(
  messaging: IPeerMessaging | undefined,
  mesh: TMeshPeers | undefined,
): TPeerRoutes {
  const offline = {
    state: 'failed' as const,
    reason: 'this session cannot reach other sessions yet',
  };
  return {
    send: async (target, text, options) => {
      const ack =
        mesh?.isLinked(target) === true
          ? await mesh.send(target, text, options)
          : messaging !== undefined
            ? await messaging.send(target, text, options)
            : offline;
      return { state: ack.state, ...(ack.reason !== undefined ? { reason: ack.reason } : {}) };
    },
    // Checked and measured here, sent only when the caller says so: the model's tool asks the
    // operator in between, and nothing is read from the peer until then.
    prepareFile: async (target, path, { origin, cwd }) => {
      const prepared = await prepareOutgoingFile({
        path,
        cwd,
        home: homedir(),
        origin,
        maxBytes: DEFAULT_MAX_FILE_BYTES,
      });
      if (!prepared.ok) return prepared;
      const { file } = prepared;
      return {
        ok: true,
        file: {
          path: file.path,
          size: file.size,
          sha256: file.sha256,
          send: async () =>
            mesh?.isLinked(target) === true
              ? mesh.sendFile(target, file)
              : messaging !== undefined
                ? messaging.sendFile(target, file)
                : offline,
        },
      };
    },
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
  mesh?: TMeshPeers,
): ILocalPeerPresence | undefined {
  try {
    // Generated here, not passed in. A session id identifies THIS process for its whole life and has
    // no other source; asking the caller for one would let two call sites disagree about what a
    // session is, which is the question the registry keys on.
    const presence = announce({ sessionId: randomUUID() });
    adapters.localPeers = buildLocalPeersHostAdapter(presence, mesh);
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
  files?: IPeerFileReceiving,
  onHandoff?: IPeerMessagingOptions['onHandoff'],
  mesh?: TMeshPeers,
): Promise<IPeerMessaging | undefined> {
  const adapter = adapters.localPeers;
  if (presence === undefined || adapter === undefined) return Promise.resolve(undefined);

  // The PREVIOUS listener is closed before a new one binds. `onChannelReady` fires again on every
  // session switch — render.tsx says so on the call itself — and the socket path is derived from the
  // session id, which does not change. `listenForPeerMessages` unlinks the path before binding, so a
  // second bind SUCCEEDS and the first server is simply orphaned: a listener and its fd per switch,
  // leaking silently because nothing errors.
  return closeQuietly(previous, report).then(() =>
    startMessaging(adapter, presence, getSession, report, start, files, onHandoff, mesh),
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
  files: IPeerFileReceiving | undefined,
  onHandoff: IPeerMessagingOptions['onHandoff'],
  mesh: TMeshPeers | undefined,
): Promise<IPeerMessaging | undefined> {
  return start({
    ...(files !== undefined ? { files } : {}),
    ...(onHandoff !== undefined ? { onHandoff } : {}),
    guardedDirectory: presence.guardedDirectory,
    sessionId: presence.sessionId,
    list: () => presence.list(),
    relate: async (sessionId) => (await presence.relate(sessionId))?.relation,
    report: (message) => report.writeError(message),
    ingress: sessionPeerIngress(getSession),
  }).then(
    (messaging) => {
      Object.assign(adapter, peerRoutes(messaging, mesh));
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
  handoff?: IHandoffWiring,
  /** The device mesh, which the interactive session may open later; its links appear as they come. */
  mesh?: TMeshPeers,
): (channel: {
  getSession(): IPeerIngressSession;
  readonly isActiveForPeerStatus?: boolean;
}) => void {
  adapters.remoteControl = buildRemoteControlHostAdapter(controller);
  const presence = attachLocalPeerDiscovery(adapters, report, announce, mesh);
  let live: { session?: IPeerIngressSession; messaging?: IPeerMessaging } = {};
  const onHandoff =
    presence !== undefined && handoff !== undefined
      ? attachHandoff(adapters, presence, controller, report, handoff, () => live, mesh)
      : undefined;
  // Returns the ACTIVATOR rather than the presence, so the composition root names one thing and
  // never learns what messaging needs from it.
  //
  // The handle is carried across calls because channel-ready fires AGAIN on every session switch.
  // Threading it here rather than inside the attach keeps that state owned by the thing whose
  // lifetime it matches — one activator per process — instead of a module-level variable.
  let running: Promise<IPeerMessaging | undefined> | undefined;
  let stopStatus: (() => void) | undefined;
  return (channel) => {
    stopStatus?.();
    stopStatus = undefined;
    if (presence !== undefined) {
      const session = channel.getSession();
      if (isObservableSession(session) && typeof channel.isActiveForPeerStatus === 'boolean') {
        stopStatus = bindLocalPeerStatus(
          presence,
          {
            getSession: () => session,
            get isActiveForPeerStatus() {
              return channel.isActiveForPeerStatus === true;
            },
          },
          (message) => report.writeError(message),
        );
      }
    }
    live = { session: channel.getSession() };
    const current = live;
    // A linked device's message enters this session exactly as a local peer's does.
    mesh?.bind({ ingress: sessionPeerIngress(() => channel.getSession()) });
    running = attachLocalPeerMessaging(
      adapters,
      presence,
      () => channel.getSession(),
      report,
      startLocalPeerMessaging,
      running,
      // Files are kept under this HOME, and each one is put to the operator at this terminal.
      {
        root: userLocalStorageRoot(),
        ...(controller.operatorApprover !== undefined
          ? { approver: controller.operatorApprover }
          : {}),
      },
      onHandoff,
      mesh,
    );
    void running.then((messaging) => {
      if (live === current && messaging !== undefined) live = { ...current, messaging };
    });
  };
}

/** What `/handoff` needs from the composition root beyond the peer channel. */
export interface IHandoffWiring {
  /** This session's project store: what is handed off is read from it, what arrives is saved to it. */
  readonly sessionStore: IInteractiveSessionStore;
  /** Whether this machine built its provider from its own configuration; credentials never travel. */
  readonly hasOwnProvider: () => boolean;
  /** The session has moved: end this process. */
  readonly onHandedOff: () => void;
}

/** A session, as `/handoff` reads it, when the live one offers what it needs. */
function handoffSession(
  session: IPeerIngressSession | undefined,
): IHandoffSourceSession | undefined {
  const candidate = session as Partial<IHandoffSourceSession> | undefined;
  return candidate !== undefined &&
    typeof candidate.getSessionId === 'function' &&
    typeof candidate.getCwd === 'function' &&
    typeof candidate.isExecuting === 'function'
    ? (candidate as IHandoffSourceSession)
    : undefined;
}

/**
 * `/handoff` over the same-host peer channel and the device mesh: the adapter that pushes this
 * session, and the receiver for a session pushed here. Returns what the listener hands each hand-off
 * channel to.
 */
function attachHandoff(
  adapters: ICommandHostAdapters,
  presence: ILocalPeerPresence,
  controller: RemoteControlController,
  report: IAdapterReporter,
  wiring: IHandoffWiring,
  live: () => { session?: IPeerIngressSession; messaging?: IPeerMessaging },
  mesh: TMeshPeers | undefined,
): NonNullable<IPeerMessagingOptions['onHandoff']> {
  const root = userLocalStorageRoot();
  const credentials = createHostCredentialStore({ root, notify: () => {} });
  const composition = createHandoffComposition();
  adapters.handoff = createHandoffHostAdapter({
    root,
    store: credentials.store,
    composition,
    sessionStore: wiring.sessionStore,
    getSession: () => handoffSession(live().session),
    peers: { list: () => presence.list(), ownSessionId: () => presence.sessionId },
    openChannel: () => {
      const messaging = live().messaging;
      return messaging === undefined
        ? undefined
        : (target: string) => messaging.openHandoffChannel(target);
    },
    ...(mesh !== undefined
      ? {
          devices: {
            list: () => mesh.devices(),
            push: (deviceId: string, options: Parameters<TMeshPeers['handoff']>[1]) =>
              mesh.handoff(deviceId, options),
          },
        }
      : {}),
    onHandedOff: wiring.onHandedOff,
  });
  const receive = createHandoffReceiver({
    root,
    composition,
    identity: () => readHandoffIdentity(root),
    resolveCredential: wiring.hasOwnProvider,
    // Saved into this session's project, where the operator resumes it; the source's path means
    // nothing here. Nothing starts it.
    persist: (record) => {
      const cwd = handoffSession(live().session)?.getCwd() ?? record.cwd;
      wiring.sessionStore.save({ ...record, cwd });
      return true;
    },
    deviceLabel: 'this session',
  });
  // A linked device's hand-off reaches the same receiver, asked on the link's own authority.
  mesh?.bind({
    handoff: {
      receive,
      onOutcome: (from, outcome) =>
        report.writeError(
          describeHandoffArrival(`device ${from}`, outcome, formatRobotaResumeCommand),
        ),
    },
  });
  return (sender, channel) => {
    const arrival = localHandoffArrival(
      {
        sessionId: presence.sessionId,
        root,
        ...(controller.operatorApprover !== undefined
          ? { approver: controller.operatorApprover }
          : {}),
      },
      sender,
      channel,
    );
    void receive(arrival).then((outcome) =>
      report.writeError(
        describeHandoffArrival(sender.sessionId, outcome, formatRobotaResumeCommand),
      ),
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
