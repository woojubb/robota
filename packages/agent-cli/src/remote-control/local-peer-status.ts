import type { ILocalPeerPresence } from './local-peer-presence.js';
import type {
  ISessionEvents,
  ISessionExecutionState,
  ISessionLifecycle,
} from '@robota-sdk/agent-interface-session';

type TObservedSession = ISessionEvents &
  Pick<ISessionExecutionState, 'isExecuting'> &
  Partial<Pick<ISessionLifecycle, 'isInitialized'>>;

/** Bind one TUI session's content-free activity to the process announcement. */
export function bindLocalPeerStatus(
  presence: Pick<ILocalPeerPresence, 'publishStatus'>,
  session: TObservedSession,
  report: (message: string) => void = (message) => process.emitWarning(message),
): () => void {
  const pending = new Set<string>();
  let active = true;
  const publish = (status: 'working' | 'needs-input' | 'idle' | undefined): void => {
    if (!active) return;
    try {
      presence.publishStatus(status);
    } catch (error) {
      report(`Local peer activity publication failed: ${String(error)}`);
    }
  };
  const reconcile = (): void =>
    publish(pending.size > 0 ? 'needs-input' : session.isExecuting() ? 'working' : 'idle');
  const onTurn = (): void => publish(pending.size > 0 ? 'needs-input' : 'working');
  const onPermission = (event: { id: string }): void => {
    pending.add(event.id);
    publish('needs-input');
  };
  const onAsk = (event: { id: string }): void => {
    pending.add(event.id);
    publish('needs-input');
  };
  const onResolved = (event: { id: string }): void => {
    pending.delete(event.id);
    reconcile();
  };
  const onEnd = (): void => {
    pending.clear();
    publish('idle');
  };
  session.on('turn_source', onTurn);
  session.on('permission_request', onPermission);
  session.on('ask_request', onAsk);
  session.on('prompt_resolved', onResolved);
  session.on('complete', onEnd);
  session.on('error', onEnd);
  session.on('interrupted', onEnd);
  // Channel-ready fires before runtime start. Claim idle only after initialization completes.
  let readyCheck: ReturnType<typeof setInterval> | undefined;
  if (session.isInitialized === true) reconcile();
  else if (session.isInitialized === false) {
    readyCheck = setInterval(() => {
      if (session.isInitialized !== true) return;
      clearInterval(readyCheck);
      readyCheck = undefined;
      reconcile();
    }, 1_000);
    readyCheck.unref?.();
  }
  return () => {
    active = false;
    if (readyCheck) clearInterval(readyCheck);
    session.off('turn_source', onTurn);
    session.off('permission_request', onPermission);
    session.off('ask_request', onAsk);
    session.off('prompt_resolved', onResolved);
    session.off('complete', onEnd);
    session.off('error', onEnd);
    session.off('interrupted', onEnd);
    try {
      presence.publishStatus(undefined);
    } catch (error) {
      report(`Local peer activity reset failed: ${String(error)}`);
    }
  };
}
