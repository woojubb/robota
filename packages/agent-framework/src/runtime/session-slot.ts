/**
 * #3189 — the runtime host's current session, behind one stable object.
 *
 * A host that can change its session keeps every consumer on this slot instead of on a session:
 * transports, supervised control and the rename hook close over the slot once, and each call reaches
 * whichever session is current. Listeners are the one thing a plain forwarder cannot carry across a
 * change, so the slot keeps them itself and moves them onto the next session when it takes over.
 */

import type {
  IInteractiveSession,
  IInteractiveSessionEvents,
  TInteractiveEventName,
} from '@robota-sdk/agent-interface-session';
import type { InteractiveSession } from '../interactive/interactive-session.js';

/** Upper bound on a graceful session shutdown so a wedged subsystem cannot block exit or a switch. */
export const RUNTIME_SHUTDOWN_TIMEOUT_MS = 5000;

/**
 * Shut a session down, giving up after `timeoutMs`. Failures are swallowed: the caller is leaving
 * that session behind either way.
 */
export async function shutdownSessionBounded(
  session: Pick<IInteractiveSession, 'shutdown'>,
  message: string,
  timeoutMs = RUNTIME_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  // The losing side of a `Promise.race` is not cancelled, so the bound's timer outlives the race
  // it lost. An un-unref'd one keeps the event loop alive for its full duration: measured on
  // `robota --serve`, teardown finished in 1ms and the process then sat for 5006ms with no
  // handles and a single `Timeout` as its only live resource. The bound exists so a wedged
  // subsystem cannot block exit — a bound that DELAYS exit by its own length in the normal case
  // is the opposite of that.
  //
  // Cancelling it is enough, and is what the bound means: once the race has an answer the bound
  // has done its job, whichever side won. `unref()` would also work — measured, either alone
  // fixes it — but it leaves the timer armed and merely non-blocking, which is a weaker
  // statement than "this is finished".
  let bound: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    // allow-fallback: best-effort session shutdown — a wedged subsystem must not block exit.
    session.shutdown({ reason: 'other', message }).catch(() => undefined),
    new Promise((resolve) => {
      bound = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (bound !== undefined) clearTimeout(bound);
}

type THandler = (...args: never[]) => void;

export interface ISessionSlotOptions {
  /** Bound on shutting the replaced session down; defaults to {@link RUNTIME_SHUTDOWN_TIMEOUT_MS}. */
  shutdownTimeoutMs?: number;
}

/**
 * A stable {@link IInteractiveSession} that forwards every member to the current session. `replace`
 * makes another session current: listeners move to it, the old one is shut down, and the slot's
 * listeners receive `session_switched`.
 */
export class SessionSlot<
  TSession extends IInteractiveSession = InteractiveSession,
> implements IInteractiveSession {
  private currentSession: TSession;
  private readonly listeners = new Map<TInteractiveEventName, Set<THandler>>();
  private readonly shutdownTimeoutMs: number;

  constructor(initial: TSession, options: ISessionSlotOptions = {}) {
    this.currentSession = initial;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? RUNTIME_SHUTDOWN_TIMEOUT_MS;
  }

  /** The session every call reaches now. Read it at call time; it changes on `replace`. */
  get current(): TSession {
    return this.currentSession;
  }

  /**
   * Make `next` the current session. Listeners registered on the slot move to it before the old
   * session shuts down (bounded), so no event of the new session is missed; `session_switched`
   * follows once the old one is gone.
   */
  async replace(next: TSession, message = 'session switched'): Promise<void> {
    const previous = this.currentSession;
    if (next === previous) return;
    // Read before anything moves: a session that cannot name itself must not half-replace the slot.
    const sessionId = next.getSession().getSessionId();
    for (const [event, handlers] of this.listeners) {
      for (const handler of handlers) {
        previous.off(event, handler as IInteractiveSessionEvents[typeof event]);
        next.on(event, handler as IInteractiveSessionEvents[typeof event]);
      }
    }
    this.currentSession = next;
    await shutdownSessionBounded(previous, message, this.shutdownTimeoutMs);
    for (const handler of [...(this.listeners.get('session_switched') ?? [])]) {
      (handler as IInteractiveSessionEvents['session_switched'])({ sessionId });
    }
  }

  on<E extends TInteractiveEventName>(event: E, handler: IInteractiveSessionEvents[E]): void {
    let handlers = this.listeners.get(event);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(event, handlers);
    }
    handlers.add(handler as THandler);
    this.currentSession.on(event, handler);
  }

  off<E extends TInteractiveEventName>(event: E, handler: IInteractiveSessionEvents[E]): void {
    this.listeners.get(event)?.delete(handler as THandler);
    this.currentSession.off(event, handler);
  }

  get isInitialized(): boolean {
    return this.currentSession.isInitialized;
  }

  shutdown: IInteractiveSession['shutdown'] = (...args) => this.currentSession.shutdown(...args);
  submit: IInteractiveSession['submit'] = (...args) => this.currentSession.submit(...args);
  abort: IInteractiveSession['abort'] = (...args) => this.currentSession.abort(...args);
  cancelQueue: IInteractiveSession['cancelQueue'] = (...args) =>
    this.currentSession.cancelQueue(...args);
  setGoal: IInteractiveSession['setGoal'] = (...args) => this.currentSession.setGoal(...args);
  getGoalState: IInteractiveSession['getGoalState'] = (...args) =>
    this.currentSession.getGoalState(...args);
  cancelGoal: IInteractiveSession['cancelGoal'] = (...args) =>
    this.currentSession.cancelGoal(...args);
  isExecuting: IInteractiveSession['isExecuting'] = (...args) =>
    this.currentSession.isExecuting(...args);
  getPendingPrompt: IInteractiveSession['getPendingPrompt'] = (...args) =>
    this.currentSession.getPendingPrompt(...args);
  getPendingCount: IInteractiveSession['getPendingCount'] = (...args) =>
    this.currentSession.getPendingCount(...args);
  getActiveDriverId: IInteractiveSession['getActiveDriverId'] = (...args) =>
    this.currentSession.getActiveDriverId(...args);
  getMessages: IInteractiveSession['getMessages'] = (...args) =>
    this.currentSession.getMessages(...args);
  getContextState: IInteractiveSession['getContextState'] = (...args) =>
    this.currentSession.getContextState(...args);
  getSession: IInteractiveSession['getSession'] = (...args) =>
    this.currentSession.getSession(...args);
  getCwd: IInteractiveSession['getCwd'] = (...args) => this.currentSession.getCwd(...args);
  executeCommand: IInteractiveSession['executeCommand'] = (...args) =>
    this.currentSession.executeCommand(...args);
  listCommands: IInteractiveSession['listCommands'] = (...args) =>
    this.currentSession.listCommands(...args);
  listSkills: IInteractiveSession['listSkills'] = (...args) =>
    this.currentSession.listSkills(...args);
  getStatusSnapshot: IInteractiveSession['getStatusSnapshot'] = (...args) =>
    this.currentSession.getStatusSnapshot(...args);
  listRuntimeTools: IInteractiveSession['listRuntimeTools'] = (...args) =>
    this.currentSession.listRuntimeTools(...args);
  invokeRuntimeTool: IInteractiveSession['invokeRuntimeTool'] = (...args) =>
    this.currentSession.invokeRuntimeTool(...args);
  resolvePermission: IInteractiveSession['resolvePermission'] = (...args) =>
    this.currentSession.resolvePermission(...args);
  resolveAsk: IInteractiveSession['resolveAsk'] = (...args) =>
    this.currentSession.resolveAsk(...args);
  listBackgroundTasks: IInteractiveSession['listBackgroundTasks'] = (...args) =>
    this.currentSession.listBackgroundTasks(...args);
  getBackgroundTask: IInteractiveSession['getBackgroundTask'] = (...args) =>
    this.currentSession.getBackgroundTask(...args);
  cancelBackgroundTask: IInteractiveSession['cancelBackgroundTask'] = (...args) =>
    this.currentSession.cancelBackgroundTask(...args);
  closeBackgroundTask: IInteractiveSession['closeBackgroundTask'] = (...args) =>
    this.currentSession.closeBackgroundTask(...args);
  sendBackgroundTask: IInteractiveSession['sendBackgroundTask'] = (...args) =>
    this.currentSession.sendBackgroundTask(...args);
  readBackgroundTaskLog: IInteractiveSession['readBackgroundTaskLog'] = (...args) =>
    this.currentSession.readBackgroundTaskLog(...args);
  listBackgroundJobGroups: IInteractiveSession['listBackgroundJobGroups'] = (...args) =>
    this.currentSession.listBackgroundJobGroups(...args);
  getBackgroundJobGroup: IInteractiveSession['getBackgroundJobGroup'] = (...args) =>
    this.currentSession.getBackgroundJobGroup(...args);
  createBackgroundJobGroup: IInteractiveSession['createBackgroundJobGroup'] = (...args) =>
    this.currentSession.createBackgroundJobGroup(...args);
  waitBackgroundJobGroup: IInteractiveSession['waitBackgroundJobGroup'] = (...args) =>
    this.currentSession.waitBackgroundJobGroup(...args);
  getExecutionWorkspaceSnapshot: IInteractiveSession['getExecutionWorkspaceSnapshot'] = (...args) =>
    this.currentSession.getExecutionWorkspaceSnapshot(...args);
  listAgentDefinitions: IInteractiveSession['listAgentDefinitions'] = (...args) =>
    this.currentSession.listAgentDefinitions(...args);
  listAgentJobs: IInteractiveSession['listAgentJobs'] = (...args) =>
    this.currentSession.listAgentJobs(...args);
  spawnAgentJob: IInteractiveSession['spawnAgentJob'] = (...args) =>
    this.currentSession.spawnAgentJob(...args);
  sendAgentJob: IInteractiveSession['sendAgentJob'] = (...args) =>
    this.currentSession.sendAgentJob(...args);
  cancelAgentJob: IInteractiveSession['cancelAgentJob'] = (...args) =>
    this.currentSession.cancelAgentJob(...args);
  closeAgentJob: IInteractiveSession['closeAgentJob'] = (...args) =>
    this.currentSession.closeAgentJob(...args);
}
