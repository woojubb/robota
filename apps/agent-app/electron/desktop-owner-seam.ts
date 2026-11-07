import { randomUUID } from 'node:crypto';

import type { TDesktopSecret } from './secret-window.js';
import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport';

interface ISessionChannel {
  send(message: TClientMessage): void;
  onMessage(listener: (message: TServerMessage) => void): () => void;
}

interface IOwnerLink {
  readonly standing: 'owner' | 'spawner';
  readonly binding: { readonly runtimeId: string; readonly generation: string };
  readonly custody: { readonly certified: boolean; readonly unlocked: boolean };
  readonly session: ISessionChannel;
  readonly closed: Promise<void>;
  onCustody(listener: (state: { readonly certified: boolean; readonly unlocked: boolean }) => void): () => void;
  control(request: { readonly command: string; readonly fields: Readonly<Record<string, string>> }): Promise<Readonly<Record<string, unknown>>>;
  question(sessionId: string): Promise<TStoredSessionQuestion>;
  cancelQuestion(): Promise<void>;
  openAccepted(bindingId: string, sessionId: string, digest: string, questionId: string): Promise<void>;
  unlock(): Promise<'verified' | 'mismatch'>;
  lock(reason: 'explicit' | 'screen-lock' | 'suspend' | 'fault'): Promise<void>;
  revokeToCleanup(): void;
  close(): void;
}

type TStoredSessionQuestion =
  | { readonly kind: 'open' }
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'accept'; readonly digest: string; readonly questionId: string; readonly notice: string; readonly question: string };

interface IOwner {
  readonly link: IOwnerLink;
  /** False only when this authenticated link joined an already attached live client set. */
  readonly grantNeeded?: boolean;
  /** Authenticated by the trusted provider's complete candidate selection. */
  readonly selected: { readonly runtimeId: string; readonly generation: string };
  assertWorkspace?(): void;
  release(): void;
}

interface IOptions {
  readonly expected: { readonly workspace: string; readonly restricted: boolean };
  readonly requestSecret: (signal: AbortSignal) => Promise<TDesktopSecret | undefined>;
  /** Must authenticate the link before returning it; a discovery record alone is insufficient. */
  readonly openOwner: (secret: TDesktopSecret, signal: AbortSignal) => Promise<IOwner>;
  readonly openRelay: (session: ISessionChannel, signal: AbortSignal, isCurrent: () => boolean) => { dispose(): void };
}

type TResult = { readonly kind: 'open'; close(reason?: 'explicit' | 'screen-lock' | 'suspend'): Promise<void>; activity(): void;
  listUnverified(): Promise<readonly string[]>; question(sessionId: string): Promise<TStoredSessionQuestion>;
  cancelQuestion(): Promise<void>; accept(sessionId: string, digest: string, questionId: string): Promise<void> }
  | { readonly kind: 'cancelled' | 'timed-out' | 'refused' | 'busy' | 'lock-unconfirmed' };

const MAX_EARLY_BYTES = 1024 * 1024;
const MAX_EARLY_FRAMES = 1024;
const LOCK_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;
const ABORTED = Symbol('aborted');

/**
 * This is an injected main-process seam. No production entry or renderer IPC invokes it.
 * The main owner must abort the request on window, workspace or generation changes.
 */
export function createDesktopOwnerCoordinator(options: IOptions): {
  open(request: { readonly signal: AbortSignal; readonly isCurrent: () => boolean }): Promise<TResult>;
} {
  const { workspace, restricted } = options.expected;
  let occupied = false;
  let faulted = false;
  return {
    async open(request): Promise<TResult> {
      if (faulted) return { kind: 'lock-unconfirmed' };
      if (occupied) return { kind: 'busy' };
      occupied = true;
      const lifetime = new AbortController();
      let owner: IOwner | undefined;
      let relay: { dispose(): void } | undefined;
      let releaseFrames: (() => void) | undefined;
      let releaseCustody: (() => void) | undefined;
      let ended = false;
      let grantAttempted = false;
      let grantSettled = false;
      let attachedSucceeded = false;
      let timedOut = false;
      let opened = false;
      let rootFault = false;
      let activityPending = false;
      let lastActivityAt = 0;
      let openingOwner = false;
      let lateDisposed = false;
      let endPromise: Promise<boolean> | undefined;
      let globalLockReason: 'explicit' | 'screen-lock' | 'suspend' | 'fault' | undefined;
      let lockOpportunityClosed = false;
      let globalLockConfirmed = false;
      let finishSettled = false;
      let lateGlobalUnconfirmed = false;
      let triggerGlobalLock: ((reason: 'explicit' | 'screen-lock' | 'suspend' | 'fault') => void) | undefined;
      const listeners = new Set<(message: TServerMessage) => void>();
      const early: TServerMessage[] = [];
      let earlyBytes = 0;
      let draining = false;
      const current = (): boolean => {
        try { return !lifetime.signal.aborted && request.isCurrent(); } catch { return false; }
      };
      const assertWorkspace = (): void => {
        try { owner?.assertWorkspace?.(); }
        catch (error) { rootFault = true; if (opened) abort(true); throw error; }
      };
      const abort = (fault = false): void => {
        lifetime.abort();
        const reason = request.signal.reason;
        const globalReason = reason === 'explicit' || reason === 'screen-lock' || reason === 'suspend'
          ? reason : fault ? 'fault' : undefined;
        if (opened) void finish(false, globalReason);
      };
      const onRequestAbort = (): void => abort();
      const finish = (alreadyLocked: boolean, globalReason?: 'explicit' | 'screen-lock' | 'suspend' | 'fault'): Promise<boolean> => {
        const requestedReason = globalReason ?? (rootFault ? 'fault' : undefined) ?? (
          request.signal.reason === 'explicit' || request.signal.reason === 'screen-lock' || request.signal.reason === 'suspend'
            ? request.signal.reason : undefined
        );
        if (requestedReason) globalLockReason = requestedReason;
        if (endPromise) {
          if (requestedReason && lockOpportunityClosed && !globalLockConfirmed) lateGlobalUnconfirmed = true;
          else if (requestedReason) triggerGlobalLock?.(requestedReason);
          if (requestedReason && finishSettled && !globalLockConfirmed) return Promise.resolve(true);
          return endPromise;
        }
        let lockRequired = Boolean(owner && !alreadyLocked &&
          (globalLockReason !== undefined || (grantAttempted && !grantSettled)));
        let complete!: (uncertain: boolean) => void;
        endPromise = new Promise<boolean>((resolve) => { complete = resolve; });
        ended = true;
        let cleanupFailed = false;
        let revoked = false;
        let released = false;
        let globalBarrier: Promise<void> | undefined;
        let globalBarrierFailed = false;
        const safely = (action: (() => void) | undefined): void => {
          try { action?.(); } catch { cleanupFailed = true; }
        };
        const revoke = (): void => {
          if (revoked) return;
          revoked = true;
          owner?.link.revokeToCleanup();
        };
        const release = (): void => {
          if (released) return;
          released = true;
          owner?.release();
        };
        const startGlobalLock = (reason: 'explicit' | 'screen-lock' | 'suspend' | 'fault'): void => {
          if (!owner || alreadyLocked || globalBarrier) return;
          if (lockOpportunityClosed) { lateGlobalUnconfirmed = true; return; }
          // Revoke and wipe synchronously with the OS event, before any transport wait.
          safely(revoke);
          safely(release);
          let attempt: Promise<void>;
          try { attempt = owner.link.lock(reason); }
          catch { globalBarrierFailed = true; globalBarrier = Promise.resolve(); return; }
          let timer: ReturnType<typeof setTimeout> | undefined;
          globalBarrier = Promise.race([attempt, new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Lock confirmation timed out.')), LOCK_TIMEOUT_MS);
          })]).then(() => { globalLockConfirmed = true; }, () => { globalBarrierFailed = true; })
            .finally(() => { if (timer !== undefined) clearTimeout(timer); });
        };
        triggerGlobalLock = startGlobalLock;
        safely(() => lifetime.abort());
        request.signal.removeEventListener('abort', onRequestAbort);
        safely(() => relay?.dispose());
        safely(releaseFrames);
        safely(releaseCustody);
        if (lockRequired || alreadyLocked) { safely(revoke); safely(release); }
        listeners.clear();
        early.length = 0;
        if (globalLockReason && !alreadyLocked) startGlobalLock(globalLockReason);
        void (async () => {
          let uncertain = grantAttempted && !grantSettled;
          if (owner && (opened || attachedSucceeded) && !alreadyLocked && !lockRequired && !globalBarrier) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              const answer = await Promise.race([owner.link.control({ command: 'owner-detach', fields: {} }),
                new Promise<never>((_resolve, reject) => {
                  timer = setTimeout(() => reject(new Error('Owner detach timed out.')), LOCK_TIMEOUT_MS);
                })]);
              if (answer.status !== 'detached') throw new Error('The runtime did not confirm owner detach.');
            } catch { if (!globalBarrier) uncertain = true; lockRequired = true; }
            finally { if (timer !== undefined) clearTimeout(timer); }
          }
          if (globalLockReason !== undefined && !alreadyLocked && !globalBarrier) startGlobalLock(globalLockReason);
          if (globalBarrier) {
            await globalBarrier;
            if (globalBarrierFailed) uncertain = true;
          } else if (owner && lockRequired) {
            safely(revoke);
            safely(release);
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              await Promise.race([owner.link.lock('fault'), new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Lock confirmation timed out.')), LOCK_TIMEOUT_MS);
              })]);
              globalLockConfirmed = true;
            } catch { uncertain = true; }
            finally { if (timer !== undefined) clearTimeout(timer); }
          }
          safely(revoke);
          lockOpportunityClosed = true;
          safely(() => owner?.link.close());
          safely(release);
          if (owner) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              await Promise.race([owner.link.closed, new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Owner link closure timed out.')), LOCK_TIMEOUT_MS);
              })]);
            } catch { cleanupFailed = true; }
            finally { if (timer !== undefined) clearTimeout(timer); }
          }
          if (uncertain || cleanupFailed || lateGlobalUnconfirmed) faulted = true;
          if (!openingOwner && !cleanupFailed) occupied = false;
          finishSettled = true;
          complete(uncertain || cleanupFailed || lateGlobalUnconfirmed);
        })();
        return endPromise;
      };
      const wait = async <T>(promise: Promise<T>, timeoutMs?: number): Promise<T | typeof ABORTED> => {
        void promise.catch(() => {});
        if (!current()) return ABORTED;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let remove = (): void => {};
        const cancelled = new Promise<typeof ABORTED>((resolve) => {
          const onAbort = (): void => resolve(ABORTED);
          lifetime.signal.addEventListener('abort', onAbort, { once: true });
          remove = () => lifetime.signal.removeEventListener('abort', onAbort);
          if (!current()) resolve(ABORTED);
          if (timeoutMs !== undefined) timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
        });
        try { const result = await Promise.race([promise, cancelled]); return current() ? result : ABORTED; }
        finally { remove(); if (timer !== undefined) clearTimeout(timer); }
      };
      const cancellation = (): TResult => ({ kind: timedOut ? 'timed-out' : 'cancelled' });
      request.signal.addEventListener('abort', onRequestAbort, { once: true });
      if (request.signal.aborted || !current()) lifetime.abort();
      try {
        if (!current()) { await finish(false); return { kind: 'cancelled' }; }
        const secret = await wait(options.requestSecret(lifetime.signal));
        if (secret === ABORTED || secret === undefined) {
          await finish(false);
          return { kind: 'cancelled' };
        }
        openingOwner = true;
        let pendingOwner: Promise<IOwner>;
        try { pendingOwner = options.openOwner(secret, lifetime.signal); }
        catch (error) { openingOwner = false; throw error; }
        const discardLate = (late: IOwner): void => {
          if (lateDisposed || late === owner) return;
          lateDisposed = true;
          let failed = false;
          try { late.link.revokeToCleanup(); } catch { failed = true; }
          try { late.release(); } catch { failed = true; }
          try { late.link.close(); } catch { failed = true; }
          if (!failed) { openingOwner = false; if (ended && !faulted) occupied = false; }
        };
        void pendingOwner.then((late) => {
          if (ended) discardLate(late);
        }, () => { openingOwner = false; if (ended && !faulted) occupied = false; });
        const selected = await wait(pendingOwner, REQUEST_TIMEOUT_MS);
        if (selected === ABORTED) {
          await finish(false);
          void pendingOwner.then(discardLate, () => {});
          return cancellation();
        }
        owner = selected;
        openingOwner = false;
        const link = owner.link;
        const { runtimeId, generation } = owner.selected;
        if (typeof runtimeId !== 'string' || !runtimeId || typeof generation !== 'string' || !generation ||
            link.standing !== 'owner' || link.binding.runtimeId !== runtimeId || link.binding.generation !== generation || !link.custody.certified) {
          await finish(false); return { kind: 'refused' };
        }
        const drain = (): void => {
          if (draining || ended || listeners.size === 0) return;
          draining = true;
          let delivered = 0;
          try {
            while (early.length && listeners.size && current() && !ended) {
              if (++delivered > MAX_EARLY_FRAMES) { abort(); break; }
              const frame = early.shift();
              if (frame === undefined) break;
              earlyBytes -= Buffer.byteLength(JSON.stringify(frame), 'utf8');
              for (const listener of [...listeners]) listener(frame);
            }
          } catch { abort(); }
          finally { draining = false; }
        };
        releaseFrames = link.session.onMessage((message) => {
          if (ended) return;
          if (!current()) { abort(); return; }
          if (listeners.size && !draining) {
            draining = true;
            try { for (const listener of [...listeners]) listener(message); }
            catch { abort(); }
            finally { draining = false; }
            drain();
            return;
          }
          try {
            earlyBytes += Buffer.byteLength(JSON.stringify(message), 'utf8');
            if (early.length >= MAX_EARLY_FRAMES || earlyBytes > MAX_EARLY_BYTES) { abort(); return; }
            early.push(message);
          } catch { abort(); }
        });
        let certified: boolean = link.custody.certified;
        releaseCustody = link.onCustody((state) => {
          certified = state.certified;
          if (!state.certified) { abort(true); return; }
          if (grantAttempted && !state.unlocked) {
            if (opened) void finish(true);
            else abort();
          }
        });
        void link.closed.then(() => { if (!ended) abort(); }, () => { if (!ended) abort(); });
        if (!current()) { await finish(false); return { kind: 'cancelled' }; }
        const status = await wait(link.control({ command: 'status', fields: {} }), REQUEST_TIMEOUT_MS);
        if (status === ABORTED) { await finish(false); return cancellation(); }
        if (status.status !== 'running' || status.daemon !== true || status.cwd !== workspace ||
            (status.restricted !== undefined && status.restricted !== true) ||
            (status.restricted === true) !== restricted) {
          await finish(false); return { kind: 'refused' };
        }
        if (!current() || !certified || !link.custody.certified || link.standing !== 'owner' ||
            link.binding.runtimeId !== runtimeId || link.binding.generation !== generation) {
          await finish(false); return { kind: 'cancelled' };
        }
        assertWorkspace();
        if (owner.grantNeeded !== false) {
          grantAttempted = true;
          const grantPromise = link.unlock();
          void grantPromise.then(() => { grantSettled = true; }, () => {});
          const grant = await wait(grantPromise, REQUEST_TIMEOUT_MS);
          if (grant === ABORTED) { const uncertain = await finish(false); return uncertain ? { kind: 'lock-unconfirmed' } : cancellation(); }
          if (grant !== 'verified') { const uncertain = await finish(false); return { kind: uncertain ? 'lock-unconfirmed' : 'refused' }; }
        } else if (!link.custody.unlocked) {
          await finish(false, 'fault');
          return { kind: 'refused' };
        }
        if (!certified || !link.custody.certified || link.standing !== 'owner' ||
            link.binding.runtimeId !== runtimeId || link.binding.generation !== generation) {
          const uncertain = await finish(false, 'fault'); return { kind: uncertain ? 'lock-unconfirmed' : 'cancelled' };
        }
        assertWorkspace();
        const attached = await wait(link.control({ command: 'attach', fields: { mode: 'drive' } }), REQUEST_TIMEOUT_MS);
        if (attached === ABORTED) { const uncertain = await finish(false); return uncertain ? { kind: 'lock-unconfirmed' } : cancellation(); }
        if (attached.status !== 'attached' || typeof attached.driverId !== 'string' || !attached.driverId) {
          const uncertain = await finish(false); return { kind: uncertain ? 'lock-unconfirmed' : 'refused' };
        }
        attachedSucceeded = true;
        if (!certified || !link.custody.certified || link.standing !== 'owner' ||
            link.binding.runtimeId !== runtimeId || link.binding.generation !== generation) {
          const uncertain = await finish(false, 'fault'); return { kind: uncertain ? 'lock-unconfirmed' : 'cancelled' };
        }
        const sessionCurrent = (): boolean => {
          let rootCurrent = false;
          try { assertWorkspace(); rootCurrent = true; }
          catch { rootFault = true; /* Fence failure revokes this owner. */ }
          if (current() && !ended && rootCurrent && certified && link.custody.certified && link.standing === 'owner' &&
              link.binding.runtimeId === runtimeId && link.binding.generation === generation) return true;
          abort(true);
          return false;
        };
        const session: ISessionChannel = {
          send: (message) => { if (sessionCurrent()) link.session.send(message); },
          onMessage: (listener) => {
            if (ended || listeners.size) throw new Error('The desktop session is unavailable.');
            const guarded = (message: TServerMessage): void => { if (sessionCurrent()) listener(message); };
            listeners.add(guarded);
            drain();
            return () => { listeners.delete(guarded); };
          },
        };
        relay = options.openRelay(session, lifetime.signal, sessionCurrent);
        if (!current() || ended) { const uncertain = await finish(false); return uncertain ? { kind: 'lock-unconfirmed' } : cancellation(); }
        opened = true;
        return {
          kind: 'open',
          close: async (reason) => { if (await finish(false, reason)) throw new Error('The runtime lock could not be confirmed.'); },
          listUnverified: () => new Promise<readonly string[]>((resolve, reject) => {
            if (!sessionCurrent()) { reject(new Error('The secure session is closed.')); return; }
            try { assertWorkspace(); }
            catch (error) { abort(true); reject(error); return; }
            const requestId = randomUUID();
            let unsubscribe = (): void => {};
            let timer: ReturnType<typeof setTimeout> | undefined;
            const cleanup = (): void => {
              unsubscribe();
              lifetime.signal.removeEventListener('abort', onAbort);
              if (timer !== undefined) clearTimeout(timer);
            };
            const onAbort = (): void => { cleanup(); reject(new Error('The secure session closed.')); };
            unsubscribe = link.session.onMessage((message) => {
              if (message.type !== 'sessions' || message.requestId !== requestId) return;
              cleanup();
              if (!sessionCurrent()) { reject(new Error('The secure session closed.')); return; }
              resolve(message.listing.sessions.filter((row) => row.authorship === 'unverified').map((row) => row.id));
            });
            lifetime.signal.addEventListener('abort', onAbort, { once: true });
            timer = setTimeout(() => { cleanup(); reject(new Error('Stored session listing timed out.')); }, REQUEST_TIMEOUT_MS);
            try { link.session.send({ type: 'list-sessions', requestId }); }
            catch (error) { cleanup(); reject(error); }
          }),
          question: async (sessionId) => {
            if (!sessionCurrent()) throw new Error('The secure session is closed.');
            assertWorkspace();
            const answer = await link.question(sessionId);
            if (!sessionCurrent()) throw new Error('The secure session closed during review.');
            return answer;
          },
          cancelQuestion: () => link.cancelQuestion(),
          accept: (sessionId, digest, questionId) => {
            if (!sessionCurrent()) throw new Error('The secure session is closed.');
            assertWorkspace();
            return link.openAccepted(attached.driverId as string, sessionId, digest, questionId);
          },
          activity: () => {
            if (!opened || ended || !current() || activityPending || Date.now() - lastActivityAt < 1_000) return;
            activityPending = true;
            lastActivityAt = Date.now();
            void link.control({ command: 'desktop-activity', fields: {} }).then(
              (result) => { if (result.status !== 'recorded') abort(); },
              () => abort(),
            ).finally(() => { activityPending = false; });
          },
        };
      } catch {
        const uncertain = await finish(false);
        return { kind: uncertain ? 'lock-unconfirmed' : 'refused' };
      }
    },
  };
}
