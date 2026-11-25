import { realpathSync } from 'node:fs';

import { openOwnerHandover, serializeKeyring } from '@robota-sdk/agent-keyring';

import { launchAndCertifyRuntime } from './certified-runtime-launch.js';
import { readProductConversationMode } from './conversation-mode-state.js';
import { createKeyringFileStore } from './keyring-store.js';
import { openPreparedOwnerLink } from './owner-link-client.js';
import { proveWorkspaceDaemon } from './prove-workspace-daemon.js';
import { startSpawnerRuntime } from './runtime-process-launch.js';
import { listSupervisedRuntimes } from './supervised-control-client.js';
import { acquireSupervisedDaemonStartLock } from './supervised-start-lock.js';
import { ensureWorkspaceRootBroker } from './workspace-root-broker-process.js';
import { SecureWorkspaceRootFence } from './workspace-root-fence.js';
import { secureWorkspaceRoot } from './workspace-root-selection.js';

import type { IOwnerRuntimeLinkClient } from '@robota-sdk/agent-transport/link';
import type { IRuntimeStartCommand, IRuntimeStartLayout } from './runtime-process-launch.js';
import type { ISupervisedRuntime } from './supervised-control-client.js';
import type { IWorkspaceDaemonCandidate } from './workspace-daemon-proof.js';
import type { TWorkspaceRootBrokerLauncher } from './workspace-root-broker-process.js';

/** What a native owner types to open the keyring: a passphrase or a recovery key. */
export type TNativeOwnerSecret =
  | { readonly type: 'passphrase'; readonly value: string }
  | { readonly type: 'recovery'; readonly value: string };

/**
 * Everything the product decides, as plain values: where its state lives, how its runtime is started
 * and what it tells a person. The first six fields are one product layout, the rest is this opening.
 */
export interface INativeSecureOwnerOptions {
  /** The product's user-state root; it holds the conversation mode choice and names the workspace broker. */
  readonly userRoot: string;
  /** The file holding the product's wrapped master key. */
  readonly keyringPath: string;
  /** The directory the product's supervised runtimes register in. */
  readonly supervisedDirectory: string;
  /** How the product's workspace-root broker is run, and the approvals file it serves. */
  readonly broker: {
    readonly historyFile: string;
    readonly launcher: TWorkspaceRootBrokerLauncher;
  };
  /** The copy a refused workspace start lock carries. */
  readonly startLock: { readonly removalHint: string };
  /** The arguments the product's runtime reads, the names it takes a token from and its refusal copy. */
  readonly runtimeLayout: IRuntimeStartLayout;
  /** The sidecar command that starts the runtime when no daemon serves the workspace yet. */
  readonly command: IRuntimeStartCommand;
  /** The environment the started runtime inherits. */
  readonly environment: NodeJS.ProcessEnv;
  readonly workspace: string;
  /** A person chose to run this folder Restricted, without its own configuration. */
  readonly restricted: boolean;
  /** The broker's hold on that Restricted choice; required with `restricted`. */
  readonly restrictedHold?: string;
  readonly secret: TNativeOwnerSecret;
  readonly signal: AbortSignal;
}

/** The authenticated owner link, and what the caller keeps until its relay is closed. */
export interface INativeSecureOwner {
  readonly link: IOwnerRuntimeLinkClient;
  /** False only when this link joined an already attached live client set. */
  readonly grantNeeded: boolean;
  readonly selected: { readonly runtimeId: string; readonly generation: string };
  /** Throws when the workspace root or its trust is no longer the one the owner opened. */
  readonly assertWorkspace: () => void;
  /** Closes the workspace fence and disposes the owner handover. */
  readonly release: () => void;
}

/** A registry row; `restricted` is only ever the proof's, which reports it for the daemon it found. */
type TDaemonCandidateRow = IWorkspaceDaemonCandidate & {
  readonly problem?: 'invalid-registration';
  readonly restricted?: true;
};

/**
 * The rows the daemon proof takes from the registry: a runtime whose control did not answer is listed
 * as unavailable instead of being left out, so the proof refuses it rather than skipping it.
 */
export function daemonCandidates(runtimes: readonly ISupervisedRuntime[]): readonly TDaemonCandidateRow[] {
  return runtimes.map(({ id, liveness, generation, problem, status }): TDaemonCandidateRow =>
    status === undefined
      ? { id, liveness, control: 'unavailable', activity: 'unknown', ...(problem ? { problem } : {}) }
      : { id, liveness, control: 'available', activity: status.activity, generation });
}

/**
 * Open a native owner's handover, prove the workspace daemon or start and certify one, and return
 * only an authenticated owner link. The caller keeps this handover until its relay is closed.
 */
export async function openNativeSecureOwner(options: INativeSecureOwnerOptions): Promise<INativeSecureOwner> {
  if (readProductConversationMode(options.userRoot) !== 'secure') {
    throw new Error('Secure conversations are not active for this product state.');
  }
  if (options.signal.aborted) throw new Error('The desktop window is no longer available.');
  const workspace = realpathSync(options.workspace);
  const fencedRoot = secureWorkspaceRoot(workspace);
  if (options.restricted && !options.restrictedHold) {
    throw new Error('A live native Restricted folder choice is required.');
  }
  const store = createKeyringFileStore({ path: options.keyringPath, root: options.userRoot });
  const loaded = store.load();
  if (loaded.status !== 'present') throw new Error('The secure conversation keyring is missing.');
  const snapshot = serializeKeyring(loaded.keyring);
  const credential = options.secret.type === 'passphrase'
    ? { type: 'passphrase' as const, passphrase: options.secret.value }
    : { type: 'recoveryKey' as const, recoveryKey: options.secret.value };
  const handover = await openOwnerHandover(loaded.keyring, credential);
  let workspaceFence: SecureWorkspaceRootFence | undefined;
  try {
    workspaceFence = new SecureWorkspaceRootFence(
      fencedRoot,
      await ensureWorkspaceRootBroker(
        { userRoot: options.userRoot, historyFile: options.broker.historyFile },
        options.broker.launcher,
      ), !options.restricted, options.restrictedHold,
    );
    const current = store.load();
    if (options.signal.aborted || readProductConversationMode(options.userRoot) !== 'secure' ||
        current.status !== 'present' || serializeKeyring(current.keyring) !== snapshot) {
      throw new Error('The secure conversation choice or keyring changed during unlock.');
    }
    const root = options.supervisedDirectory;
    const releaseStart = await acquireSupervisedDaemonStartLock(workspace, root, {
      removalHint: options.startLock.removalHint,
    });
    let selected: { readonly id: string; readonly generation: string };
    try {
      if (options.signal.aborted) throw new Error('The desktop window is no longer available.');
      const candidates = daemonCandidates(await listSupervisedRuntimes(root));
      const found = await proveWorkspaceDaemon({ root, workspace, candidates, handover });
      if (found) {
        if ((found.restricted === true) !== options.restricted) {
          throw new Error('The secure daemon uses a different workspace access choice.');
        }
        selected = { id: found.id, generation: found.generation };
      } else {
        if (options.signal.aborted) throw new Error('The desktop window is no longer available.');
        selected = await launchAndCertifyRuntime({
          root,
          handover,
          daemonRole: true,
          start: () => startSpawnerRuntime(workspace, {
            command: options.command,
            layout: options.runtimeLayout,
            environment: options.environment,
            ...(options.restricted ? { restricted: true } : {}),
          }),
        });
      }
    } finally {
      releaseStart();
    }
    if (options.signal.aborted) throw new Error('The desktop window is no longer available.');
    const { link, grantNeeded } = await openPreparedOwnerLink({
      root, ...selected, handover, signal: options.signal,
    });
    if (options.signal.aborted) {
      link.close();
      throw new Error('The desktop window is no longer available.');
    }
    try {
      const proof = await link.control({ command: 'workspace-root-proof', fields: {} });
      const localProof = workspaceFence.proof();
      if (proof.status !== 'root-proof' || proof.tag !== localProof.tag ||
          proof.generation !== localProof.generation || proof.trustTag !== localProof.trustTag) {
        throw new Error('The secure runtime workspace root does not match the desktop root.');
      }
      const activity = await link.control({ command: 'desktop-activity-mode', fields: {} });
      if (activity.status !== 'native') throw new Error('The runtime did not accept native desktop activity.');
    } catch (error) {
      link.close();
      throw error;
    }
    return { link, grantNeeded, selected: { runtimeId: selected.id, generation: selected.generation },
      assertWorkspace: () => workspaceFence?.assertCurrent(),
      release: () => {
        try { workspaceFence?.close(); }
        finally { handover.dispose(); }
      } };
  } catch (error) {
    try { workspaceFence?.close(); }
    finally { handover.dispose(); }
    throw error;
  }
}
