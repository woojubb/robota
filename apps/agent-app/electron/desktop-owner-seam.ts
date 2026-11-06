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
  unlock(): Promise<'verified' | 'mismatch'>;
  lock(reason: 'explicit'): Promise<void>;
  close(): void;
}

interface IOwner {
  readonly link: IOwnerLink;
  /** Authenticated by the trusted provider's complete candidate selection. */
  readonly selected: { readonly runtimeId: string; readonly generation: string };
  release(): void;
}

interface IOptions {
  readonly expected: { readonly workspace: string; readonly restricted: boolean };
  readonly requestSecret: (signal: AbortSignal) => Promise<TDesktopSecret | undefined>;
  /** Must authenticate the link before returning it; a discovery record alone is insufficient. */
  readonly openOwner: (secret: TDesktopSecret, signal: AbortSignal) => Promise<IOwner>;
  readonly openRelay: (session: ISessionChannel, signal: AbortSignal, isCurrent: () => boolean) => { dispose(): void };
}

type TResult = { readonly kind: 'open'; close(): Promise<void> }
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
      let timedOut = false;
      let opened = false;
      let openingOwner = false;
      let lateDisposed = false;
      let endPromise: Promise<boolean> | undefined;
      const listeners = new Set<(message: TServerMessage) => void>();
      const early: TServerMessage[] = [];
      let earlyBytes = 0;
      let draining = false;
      const current = (): boolean => {
        try { return !lifetime.signal.aborted && request.isCurrent(); } catch { return false; }
      };
      const abort = (): void => { lifetime.abort(); if (opened) void finish(false); };
      const finish = (alreadyLocked: boolean): Promise<boolean> => {
        if (endPromise) return endPromise;
        let complete!: (uncertain: boolean) => void;
        endPromise = new Promise<boolean>((resolve) => { complete = resolve; });
        ended = true;
        let cleanupFailed = false;
        const safely = (action: (() => void) | undefined): void => {
          try { action?.(); } catch { cleanupFailed = true; }
        };
        safely(() => lifetime.abort());
        request.signal.removeEventListener('abort', abort);
        safely(() => relay?.dispose());
        safely(releaseFrames);
        safely(releaseCustody);
        listeners.clear();
        early.length = 0;
        void (async () => {
          let uncertain = grantAttempted && !grantSettled;
          if (owner && grantAttempted && !alreadyLocked) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              await Promise.race([owner.link.lock('explicit'), new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Lock confirmation timed out.')), LOCK_TIMEOUT_MS);
              })]);
            } catch { uncertain = true; }
            finally { if (timer !== undefined) clearTimeout(timer); }
          }
          safely(() => owner?.link.close());
          safely(() => owner?.release());
          if (uncertain || cleanupFailed) faulted = true;
          if (!openingOwner && !cleanupFailed) occupied = false;
          complete(uncertain || cleanupFailed);
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
      request.signal.addEventListener('abort', abort, { once: true });
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
          try { late.link.close(); } catch { failed = true; }
          try { late.release(); } catch { failed = true; }
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
          if (!state.certified) { abort(); return; }
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
        grantAttempted = true;
        const grantPromise = link.unlock();
        void grantPromise.then(() => { grantSettled = true; }, () => {});
        const grant = await wait(grantPromise, REQUEST_TIMEOUT_MS);
        if (grant === ABORTED) { const uncertain = await finish(false); return uncertain ? { kind: 'lock-unconfirmed' } : cancellation(); }
        if (grant !== 'verified') { const uncertain = await finish(false); return { kind: uncertain ? 'lock-unconfirmed' : 'refused' }; }
        const attached = await wait(link.control({ command: 'attach', fields: { mode: 'drive' } }), REQUEST_TIMEOUT_MS);
        if (attached === ABORTED) { const uncertain = await finish(false); return uncertain ? { kind: 'lock-unconfirmed' } : cancellation(); }
        if (attached.status !== 'attached' || typeof attached.driverId !== 'string' || !attached.driverId) {
          const uncertain = await finish(false); return { kind: uncertain ? 'lock-unconfirmed' : 'refused' };
        }
        const session: ISessionChannel = {
          send: (message) => { if (current() && !ended) link.session.send(message); },
          onMessage: (listener) => {
            if (ended || listeners.size) throw new Error('The desktop session is unavailable.');
            listeners.add(listener);
            drain();
            return () => { listeners.delete(listener); };
          },
        };
        relay = options.openRelay(session, lifetime.signal, current);
        if (!current() || ended) { const uncertain = await finish(false); return uncertain ? { kind: 'lock-unconfirmed' } : cancellation(); }
        opened = true;
        return { kind: 'open', close: async () => { if (await finish(false)) throw new Error('The runtime lock could not be confirmed.'); } };
      } catch {
        const uncertain = await finish(false);
        return { kind: uncertain ? 'lock-unconfirmed' : 'refused' };
      }
    },
  };
}
