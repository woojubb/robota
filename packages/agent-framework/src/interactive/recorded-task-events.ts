/**
 * The background task events a session record carries: a bounded recent window, never the whole
 * history.
 *
 * A save rewrites the whole record, and a job that streams emits an event per output chunk. A list
 * that kept them all would grow without bound and make every save cost what the whole stream has
 * been so far. The record's own task list holds each task's state; the events are what a reader
 * shows of how it got there, and the session log is the complete account when a logger is set.
 *
 * Two windows, so output cannot push a job's lifecycle out of the record:
 * - transition events (a task created, started, changed, ended, closed, woken) number a handful
 *   per task, so the window holds the lifecycle of many tasks;
 * - stream events (output text, tool calls, permission requests) arrive in bursts, so the window
 *   holds only the most recent of them.
 *
 * Platform-neutral: no host pieces, no clock.
 */

import type {
  IBackgroundTaskState,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface/execution';

/** Most transition events a record carries. */
export const MAX_RECORDED_TRANSITION_EVENTS = 500;
/** Most stream events a record carries. */
export const MAX_RECORDED_STREAM_EVENTS = 500;

/**
 * How long a stream event waits for the record to be saved; what streams in that time is saved
 * once, so the rate of saves is bounded however fast a job streams. A crash loses the stream
 * events of at most this long.
 */
export const STREAM_EVENT_SAVE_INTERVAL_MS = 1000;

/** Fields a running task rewrites on every sign of life; a change in only these is not a transition. */
const ACTIVITY_FIELDS = ['currentAction', 'lastActivityAt', 'updatedAt'] as const;

/** Whether the event is output or tool activity of a running task, which arrives in bursts. */
export function isStreamTaskEvent(event: TBackgroundTaskEvent): boolean {
  switch (event.type) {
    case 'background_task_text_delta':
    case 'background_task_tool_start':
    case 'background_task_tool_end':
    case 'background_task_permission_request':
      return true;
    default:
      return false;
  }
}

/**
 * Whether the event changes something a resume reads back: every event but the stream events and
 * an update that moved only a task's activity fields. Those two wait for the next save; this one
 * is saved when it happens.
 */
export function isDurableTaskTransition(
  event: TBackgroundTaskEvent,
  previousTasks: readonly IBackgroundTaskState[],
): boolean {
  if (isStreamTaskEvent(event)) return false;
  if (event.type !== 'background_task_updated') return true;
  const previous = previousTasks.find((task) => task.id === event.task.id);
  return previous === undefined || withoutActivity(previous) !== withoutActivity(event.task);
}

function withoutActivity(task: IBackgroundTaskState): string {
  const fields: Record<string, unknown> = { ...task };
  for (const field of ACTIVITY_FIELDS) delete fields[field];
  return JSON.stringify(fields);
}

interface IStampedEvent {
  /** The event's place among every event this list ever took, which keeps the two windows in order. */
  readonly order: number;
  readonly event: TBackgroundTaskEvent;
}

export class RecordedTaskEvents {
  private transitions: IStampedEvent[] = [];
  private stream: IStampedEvent[] = [];
  private taken = 0;

  /** Starts from events a record already carried, which may be more than a window holds. */
  constructor(events: readonly TBackgroundTaskEvent[] = []) {
    for (const event of events) this.stamp(event);
    this.transitions = this.transitions.slice(-MAX_RECORDED_TRANSITION_EVENTS);
    this.stream = this.stream.slice(-MAX_RECORDED_STREAM_EVENTS);
  }

  push(event: TBackgroundTaskEvent): void {
    this.stamp(event);
    if (this.transitions.length > MAX_RECORDED_TRANSITION_EVENTS) this.transitions.shift();
    if (this.stream.length > MAX_RECORDED_STREAM_EVENTS) this.stream.shift();
  }

  /** The kept events, oldest first. */
  toArray(): TBackgroundTaskEvent[] {
    const merged: TBackgroundTaskEvent[] = [];
    let transition = 0;
    let stream = 0;
    while (transition < this.transitions.length || stream < this.stream.length) {
      const nextTransition = this.transitions[transition];
      const nextStream = this.stream[stream];
      const takeTransition =
        nextStream === undefined ||
        (nextTransition !== undefined && nextTransition.order < nextStream.order);
      const chosen = takeTransition ? nextTransition : nextStream;
      if (takeTransition) transition += 1;
      else stream += 1;
      if (chosen !== undefined) merged.push(chosen.event);
    }
    return merged;
  }

  private stamp(event: TBackgroundTaskEvent): void {
    const stamped: IStampedEvent = { order: this.taken, event };
    this.taken += 1;
    (isStreamTaskEvent(event) ? this.stream : this.transitions).push(stamped);
  }
}
