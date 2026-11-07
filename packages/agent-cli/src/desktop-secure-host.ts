import { realpathSync } from 'node:fs';

import { openOwnerHandover, serializeKeyring } from '@robota-sdk/agent-keyring';
import { createKeyringFileStore } from '@robota-sdk/agent-local-host';

import { createCliRuntimeContext } from './product/runtime-context.js';
import { readProductConversationMode } from './secure/conversation-mode-state.js';
import { launchCertifiedRuntime } from './session-inventory/certified-runtime-launch.js';
import { openRegisteredOwnerLink } from './session-inventory/owner-link-client.js';
import { proveWorkspaceDaemon } from './session-inventory/prove-workspace-daemon.js';
import {
  acquireSupervisedDaemonStartLock,
  listSupervisedSessions,
  resolveSupervisedDirectory,
} from './session-inventory/supervised-session-control.js';

import type { IProductConfig, TConfigEnvironment } from '@robota-sdk/product-config';

export type TDesktopSecureSecret =
  | { readonly type: 'passphrase'; readonly value: string }
  | { readonly type: 'recovery'; readonly value: string };

export interface IDesktopSecureOwnerOptions {
  readonly config: IProductConfig;
  readonly environment: TConfigEnvironment;
  readonly workspace: string;
  readonly restricted: boolean;
  readonly secret: TDesktopSecureSecret;
  readonly signal: AbortSignal;
  readonly childEnvironment: NodeJS.ProcessEnv;
  readonly launchCommand: { readonly executable: string; readonly args: readonly string[] };
}

/** The main process reads the choice before it can start a plain daemon or expose its URL. */
export function desktopConversationMode(config: IProductConfig): 'plain' | 'preparing' | 'secure' {
  return readProductConversationMode(config.storage.userRoot);
}

/**
 * Open a native owner's handover, prove the workspace daemon or start and certify one, and return
 * only an authenticated owner link. The caller keeps this handover until its relay is closed.
 */
export async function openDesktopSecureOwner(options: IDesktopSecureOwnerOptions) {
  if (desktopConversationMode(options.config) !== 'secure') {
    throw new Error('Secure conversations are not active for this product state.');
  }
  if (options.signal.aborted) throw new Error('The desktop window is no longer available.');
  const workspace = realpathSync(options.workspace);
  const runtime = createCliRuntimeContext(options.config, options.environment, undefined, 'secure');
  const store = createKeyringFileStore({
    path: runtime.layout.userPaths.keyring,
    root: runtime.layout.userRoot,
  });
  const loaded = store.load();
  if (loaded.status !== 'present') throw new Error('The secure conversation keyring is missing.');
  const snapshot = serializeKeyring(loaded.keyring);
  const credential = options.secret.type === 'passphrase'
    ? { type: 'passphrase' as const, passphrase: options.secret.value }
    : { type: 'recoveryKey' as const, recoveryKey: options.secret.value };
  const handover = await openOwnerHandover(loaded.keyring, credential);
  try {
    const current = store.load();
    if (options.signal.aborted || desktopConversationMode(options.config) !== 'secure' ||
        current.status !== 'present' || serializeKeyring(current.keyring) !== snapshot) {
      throw new Error('The secure conversation choice or keyring changed during unlock.');
    }
    const root = resolveSupervisedDirectory(runtime);
    const releaseStart = await acquireSupervisedDaemonStartLock(workspace, root, {
      cliName: runtime.vocabulary.cliName,
    });
    let selected: { readonly id: string; readonly generation: string };
    try {
      if (options.signal.aborted) throw new Error('The desktop window is no longer available.');
      const candidates = await listSupervisedSessions(root, undefined, { includeGeneration: true });
      const found = await proveWorkspaceDaemon({ root, workspace, candidates, handover });
      if (found) {
        if ((found.restricted === true) !== options.restricted) {
          throw new Error('The secure daemon uses a different workspace access choice.');
        }
        selected = { id: found.id, generation: found.generation };
      } else {
        if (options.signal.aborted) throw new Error('The desktop window is no longer available.');
        selected = await launchCertifiedRuntime(workspace, {
          productRuntime: runtime,
          root,
          env: options.childEnvironment,
          handover,
          daemonRole: true,
          launchCommand: options.launchCommand,
          ...(options.restricted ? { restricted: true } : {}),
        });
      }
    } finally {
      releaseStart();
    }
    if (options.signal.aborted) throw new Error('The desktop window is no longer available.');
    const link = await openRegisteredOwnerLink({ root, ...selected, handover, signal: options.signal });
    if (options.signal.aborted) {
      link.close();
      throw new Error('The desktop window is no longer available.');
    }
    return { link, selected: { runtimeId: selected.id, generation: selected.generation }, release: () => handover.dispose() };
  } catch (error) {
    handover.dispose();
    throw error;
  }
}
