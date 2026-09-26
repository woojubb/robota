/**
 * #3189: push the session's status to every attached client when it changes.
 *
 * A client used to read the status once and then only saw what it changed itself, so one client's
 * `/mode` never reached the others. The session now emits `status_changed` after anything that can
 * change the mode, model, effort, goal or name. Context usage is left out of the comparison: it
 * changes on every turn and has its own `context_update` event, so counting it would turn every turn
 * into a status push.
 */

import type {
  ISessionStatusSnapshot,
  TInteractiveEventName,
} from '@robota-sdk/agent-interface-session';

/** The events after which the status may have changed; a command's end is pushed by the session. */
export const STATUS_CHANGING_EVENTS = [
  'complete',
  'interrupted',
  'session_renamed',
  'goal_event',
  'plan_event',
] as const satisfies readonly TInteractiveEventName[];

export interface ISessionStatusPushPort {
  /** The current status, or `undefined` while the session cannot report one (not initialized). */
  read(): ISessionStatusSnapshot | undefined;
  emit(status: ISessionStatusSnapshot): void;
}

function comparable(status: ISessionStatusSnapshot): string {
  const { context: _context, ...rest } = status;
  return JSON.stringify(rest);
}

export class SessionStatusPush {
  private last: string | undefined;

  constructor(private readonly port: ISessionStatusPushPort) {}

  /** Take the current status as already known, so the first push is a real change. */
  prime(): void {
    const status = this.read();
    if (status !== undefined) this.last = comparable(status);
  }

  /** Emit the status when it differs from the last one emitted (or primed). */
  push(): void {
    const status = this.read();
    if (status === undefined) return;
    const key = comparable(status);
    if (key === this.last) return;
    this.last = key;
    this.port.emit(status);
  }

  private read(): ISessionStatusSnapshot | undefined {
    try {
      return this.port.read();
    } catch {
      return undefined; // allow-fallback: this push is skipped; the next change pushes again.
    }
  }
}
