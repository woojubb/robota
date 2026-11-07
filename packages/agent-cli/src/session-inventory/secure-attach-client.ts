import { realpathSync } from 'node:fs';

import { SecureWorkspaceRootFence } from '../secure/workspace-root-fence.js';
import { secureWorkspaceRoot } from '../secure/workspace-root-selection.js';
import { openPreparedOwnerLink } from './owner-link-client.js';
import { MAX_EARLY_FRAMES, type ISupervisedAttachConnection } from './supervised-attach-client.js';

import type { IOwnerHandover } from '@robota-sdk/agent-keyring';
import type { TServerMessage } from '@robota-sdk/agent-transport';

const MAX_EARLY_BYTES = 1024 * 1024;

/** The caller owns and disposes the handover after the attached view ends. */
export async function openSecureAttach(options: {
  readonly root: string;
  readonly id: string;
  readonly generation: string;
  readonly workspace: string;
  readonly brokerEndpoint: string;
  readonly mode: 'drive' | 'observe';
  readonly handover: IOwnerHandover;
  readonly onMismatch?: () => void;
}): Promise<ISupervisedAttachConnection> {
  const root = secureWorkspaceRoot(realpathSync(options.workspace));
  const fence = new SecureWorkspaceRootFence(root, options.brokerEndpoint, false);
  let prepared: Awaited<ReturnType<typeof openPreparedOwnerLink>>;
  try { prepared = await openPreparedOwnerLink(options); }
  catch (error) { fence.close(); throw error; }
  const { link, grantNeeded } = prepared;
  let faultBarrier: Promise<void> | undefined;
  let detaching = false;
  let unlockAttempted = false;
  let unlockCompleted = false;
  const assertFence = (): void => {
    try { fence.assertCurrent(); }
    catch (error) {
      faultBarrier ??= lockAndClose(true);
      void faultBarrier.catch(() => {});
      throw error;
    }
  };
  const listeners = new Set<(message: TServerMessage) => void>();
  const early: TServerMessage[] = [];
  let earlyBytes = 0;
  const unsubscribe = link.session.onMessage((message) => {
    try { assertFence(); } catch { return; }
    if (listeners.size > 0) {
      for (const listener of [...listeners]) listener(message);
    } else {
      earlyBytes += Buffer.byteLength(JSON.stringify(message), 'utf8');
      if (early.length < MAX_EARLY_FRAMES && earlyBytes <= MAX_EARLY_BYTES) early.push(message);
      else link.close();
    }
  });
  let closed = false;
  const closedListeners = new Set<() => void>();
  void link.closed.then(() => {
    closed = true;
    fence.close();
    unsubscribe();
    for (const listener of [...closedListeners]) listener();
    closedListeners.clear();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  async function lockAndClose(global: boolean): Promise<void> {
    if (closed) { fence.close(); return; }
    if (!global && !link.custody.unlocked) {
      link.revokeToCleanup();
      link.close();
      await link.closed;
      fence.close();
      return;
    }
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let failed = false;
    detaching = true;
    listeners.clear();
    early.length = 0;
    try {
      if (global) {
        link.revokeToCleanup();
        await Promise.race([link.lock('fault'), new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => reject(new Error('Secure detach timed out.')), 5_000);
        })]);
      } else {
        const answer = await Promise.race([link.control({ command: 'owner-detach', fields: {} }),
          new Promise<never>((_resolve, reject) => {
            deadline = setTimeout(() => reject(new Error('Secure detach timed out.')), 5_000);
          })]);
        if (answer.status !== 'detached') throw new Error('The runtime did not confirm owner detach.');
      }
    } catch {
      failed = true;
    } finally {
      if (deadline !== undefined) clearTimeout(deadline);
      link.revokeToCleanup();
      link.close();
      fence.close();
    }
    try {
      await Promise.race([link.closed, new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error('Secure link closure timed out.')), 5_000);
      })]);
    } catch { failed = true; }
    finally { if (deadline !== undefined) clearTimeout(deadline); }
    if (failed) throw new Error('Secure detach could not confirm the runtime disposition.');
  }
  try {
    const remote = await link.control({ command: 'workspace-root-proof', fields: {} });
    const local = fence.proof();
    if (remote.status !== 'root-proof' || remote.tag !== local.tag ||
        remote.generation !== local.generation || remote.trustTag !== local.trustTag) {
      throw new Error('The secure runtime workspace root does not match this terminal.');
    }
    const attached = await Promise.race([(async () => {
      assertFence();
      let outcome: 'verified' | 'mismatch' = 'verified';
      if (grantNeeded) {
        unlockAttempted = true;
        outcome = await link.unlock();
        unlockCompleted = true;
      } else if (!link.custody.unlocked) {
        throw new Error('The shared secure runtime locked before attach.');
      }
      if (cancelled) throw new Error('Secure attach was cancelled.');
      if (outcome === 'mismatch') {
        if (options.onMismatch === undefined) throw new Error('The runtime sealing key differs from the unlocked key.');
        options.onMismatch();
      }
      return link.control({ command: 'attach', fields: { mode: options.mode } });
    })(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Secure attach timed out.')), 10_000);
    })]);
    if (attached.status !== 'attached' || typeof attached.driverId !== 'string' || attached.driverId.length === 0) {
      throw new Error('The secure runtime refused attach.');
    }
    const driverId = attached.driverId;
    return {
      driverId,
      ...(options.mode === 'drive' ? {
        ownerSessions: {
          directory: {
            question: (sessionId: string) => { assertFence(); return link.question(sessionId); },
            cancelQuestion: async () => {
              try {
                await link.cancelQuestion();
              } catch (error) {
                link.close();
                throw error;
              }
            },
            openAccepted: (sessionId: string, digest: string, questionId: string) => {
              assertFence();
              return link.openAccepted(driverId, sessionId, digest, questionId);
            },
          },
          onInvalidate: (listener: () => void) => {
            let active = true;
            const unsubscribeCustody = link.onCustody(() => { if (active) listener(); });
            if (!link.custody.unlocked) queueMicrotask(() => { if (active) listener(); });
            void link.closed.then(() => { if (active) listener(); });
            return () => { active = false; unsubscribeCustody(); };
          },
        },
      } : {}),
      send: (message) => { if (detaching) throw new Error('Secure attach is closing.'); assertFence(); link.session.send(message); },
      subscribe: (listener) => {
        if (detaching) throw new Error('Secure attach is closing.');
        listeners.add(listener);
        if (listeners.size === 1) {
          earlyBytes = 0;
          try {
            for (const message of early.splice(0)) { assertFence(); listener(message); }
          } catch (error) { listeners.delete(listener); throw error; }
        }
        return () => { listeners.delete(listener); };
      },
      onClose: (listener) => {
        if (closed) { queueMicrotask(listener); return () => {}; }
        closedListeners.add(listener);
        return () => { closedListeners.delete(listener); };
      },
      detach: () => faultBarrier ?? lockAndClose(false),
    };
  } catch (error) {
    cancelled = true;
    if (faultBarrier) {
      await faultBarrier;
      throw error;
    }
    if (unlockAttempted) {
      const unlockWasPending = !unlockCompleted;
      await lockAndClose(unlockWasPending);
      if (unlockWasPending) throw new Error('Secure attach could not confirm the runtime is locked.');
    }
    else { link.close(); fence.close(); }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
