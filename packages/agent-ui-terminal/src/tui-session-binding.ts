import type { TuiStateManager } from './tui-state-manager.js';
import type {
  IInteractiveSession,
  IInteractiveSessionEvents,
  TInteractiveEventName,
} from '@robota-sdk/agent-interface-session';

export interface ITuiSessionEventBinding {
  event: TInteractiveEventName;
  handler: (...args: never[]) => void;
}

export interface ITuiSessionBinder {
  <E extends TInteractiveEventName>(event: E, handler: IInteractiveSessionEvents[E]): void;
}

export function bindTuiSessionNoticeEvents(
  bind: ITuiSessionBinder,
  manager: TuiStateManager,
): void {
  bind('plan_event', (payload) => manager.addSessionEventNotice({ event: 'plan_event', payload }));
  bind('context_file_refreshed', (payload) =>
    manager.addSessionEventNotice({ event: 'context_file_refreshed', payload }),
  );
  bind('branch_event', (payload) =>
    manager.addSessionEventNotice({ event: 'branch_event', payload }),
  );
}

/** Isolate a TUI-owned projection failure from the session operation that already committed. */
export function bindTuiSessionEvent<E extends TInteractiveEventName>(
  session: Pick<IInteractiveSession, 'on'>,
  event: E,
  handler: IInteractiveSessionEvents[E],
  onDeliveryError: (error: Error, event: E) => void,
  bindings: ITuiSessionEventBinding[],
): void {
  const ownedHandler = ((...args: never[]): void => {
    try {
      (handler as (...values: never[]) => void)(...args);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      try {
        onDeliveryError(normalized, event);
      } catch {
        // Diagnostics cannot make a committed session operation fail.
      }
    }
  }) as IInteractiveSessionEvents[E];
  session.on(event, ownedHandler);
  bindings.push({ event, handler: ownedHandler as (...args: never[]) => void });
}
