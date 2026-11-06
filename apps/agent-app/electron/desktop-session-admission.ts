import { createDesktopOwnerCoordinator } from './desktop-owner-seam.js';
import { openDesktopSessionRelay } from './desktop-session-relay.js';

import type { IpcMain, IpcMainEvent, MessageChannelMain, WebContents } from 'electron';

const REQUEST_CHANNEL = 'desktop-session:request';
const REQUEST_READY_CHANNEL = 'desktop-session:request-ready';
type TOwnerOptions = Parameters<typeof createDesktopOwnerCoordinator>[0];
type TOwnerResult = Awaited<ReturnType<ReturnType<typeof createDesktopOwnerCoordinator>['open']>>;
type TResult = TOwnerResult | { readonly kind: 'not-ready' };

interface IAdmissionOptions extends Pick<TOwnerOptions, 'expected' | 'requestSecret' | 'openOwner'> {
  readonly sender: WebContents;
  readonly ipc: Pick<IpcMain, 'on' | 'removeListener'>;
  readonly isCurrent: () => boolean;
  readonly createChannel: () => MessageChannelMain;
  readonly onUnconfirmed: () => void;
}

/**
 * A dormant main-only adapter. Renderer IPC registers a frame, never an owner action. Production
 * must invoke `openFromNativeAction` only from an explicit native user action.
 */
export function registerDesktopSessionAdmission(options: IAdmissionOptions): {
  openFromNativeAction(): Promise<TResult>;
  dispose(): Promise<void>;
} {
  const { sender, ipc } = options;
  const frame = sender.mainFrame;
  const lifetime = new AbortController();
  let disposed = false;
  let source: Pick<IpcMainEvent, 'sender' | 'senderFrame'> | undefined;
  let active: Extract<TOwnerResult, { kind: 'open' }> | undefined;
  let opening: Promise<TResult> | undefined;
  let disposing: Promise<void> | undefined;
  let reportedUnconfirmed = false;
  const reportUnconfirmed = (): void => {
    if (reportedUnconfirmed) return;
    reportedUnconfirmed = true;
    try { options.onUnconfirmed(); } catch { /* A reporting error must not resume the session. */ }
  };
  const valid = (): boolean => {
    try { return !disposed && !lifetime.signal.aborted && !sender.isDestroyed() && sender.mainFrame === frame && options.isCurrent(); }
    catch { return false; }
  };
  const coordinator = createDesktopOwnerCoordinator({
    expected: options.expected,
    requestSecret: options.requestSecret,
    openOwner: options.openOwner,
    openRelay: (session, signal, isCurrent) => {
      if (!source || !valid() || source.senderFrame !== frame) throw new Error('The renderer is no longer eligible.');
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) { stop(); throw new Error('The owner session has closed.'); }
      return openDesktopSessionRelay({ sender, source, session, signal, isCurrent, createChannel: options.createChannel });
    },
  });
  const onRequest = (event: IpcMainEvent, ...args: unknown[]): void => {
    if (Array.isArray(event.ports) && event.ports.length !== 0) {
      for (const port of event.ports) { try { port.close(); } catch { /* Already closed. */ } }
      return;
    }
    if (!valid() || args.length !== 0 || (event.ports !== undefined && !Array.isArray(event.ports)) ||
        event.sender !== sender || event.senderFrame !== frame) return;
    if (!source) source = { sender: event.sender, senderFrame: event.senderFrame };
  };
  const stop = (): void => { void dispose().catch(() => {}); };
  const onNavigation = (details: { isMainFrame: boolean }): void => { if (details.isMainFrame) stop(); };
  function dispose(): Promise<void> {
    if (disposing) return disposing;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    disposing = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    disposed = true;
    source = undefined;
    let cleanupError: unknown;
    const cleanup = (action: () => void): void => {
      try { action(); } catch (error) { cleanupError ??= error; }
    };
    cleanup(() => { ipc.removeListener(REQUEST_CHANNEL, onRequest); });
    cleanup(() => { sender.removeListener('destroyed', stop); });
    cleanup(() => { sender.removeListener('render-process-gone', stop); });
    cleanup(() => { sender.removeListener('did-start-navigation', onNavigation); });
    cleanup(() => { lifetime.abort(); });
    void (async () => {
      const result = opening ? await opening : active;
      if (result?.kind === 'open') {
        try { await result.close(); } catch { reportUnconfirmed(); throw new Error('The runtime lock could not be confirmed.'); }
      }
      if (result?.kind === 'lock-unconfirmed') { reportUnconfirmed(); throw new Error('The runtime lock could not be confirmed.'); }
      if (cleanupError) throw cleanupError;
    })().then(resolve, reject);
    return disposing;
  }
  const register = (add: () => void, remove: () => void): void => {
    if (disposed) return;
    try { add(); } catch { stop(); }
    if (disposed) { try { remove(); } catch { /* Already unavailable. */ } return; }
    if (!valid()) stop();
  };
  register(() => { ipc.on(REQUEST_CHANNEL, onRequest); }, () => { ipc.removeListener(REQUEST_CHANNEL, onRequest); });
  register(() => { sender.on('destroyed', stop); }, () => { sender.removeListener('destroyed', stop); });
  register(() => { sender.on('render-process-gone', stop); }, () => { sender.removeListener('render-process-gone', stop); });
  register(() => { sender.on('did-start-navigation', onNavigation); }, () => { sender.removeListener('did-start-navigation', onNavigation); });
  if (valid()) { try { frame.send(REQUEST_READY_CHANNEL); } catch { stop(); } }
  return {
    async openFromNativeAction(): Promise<TResult> {
      if (!source || !valid() || source.senderFrame !== frame) return { kind: 'not-ready' };
      if (opening || active) return { kind: 'busy' };
      let resolve!: (result: TResult) => void;
      const pending = new Promise<TResult>((done) => { resolve = done; });
      opening = pending;
      void coordinator.open({ signal: lifetime.signal, isCurrent: valid }).then((result) => {
        if (result.kind === 'open') active = result;
        if (result.kind === 'lock-unconfirmed') reportUnconfirmed();
        opening = undefined;
        resolve(result);
      }, () => { opening = undefined; resolve({ kind: 'refused' }); });
      return pending;
    },
    dispose,
  };
}
