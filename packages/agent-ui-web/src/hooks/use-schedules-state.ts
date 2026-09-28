import { useCallback, useState } from 'react';

import type { IWsSessionState } from './session-client-types.js';
import type { TClientMessage } from '../client/ws-session-client.js';
import type { TServerMessage } from '@robota-sdk/agent-transport';

type TSchedulesState = Pick<
  IWsSessionState,
  'scheduledTasks' | 'pauseSchedule' | 'resumeSchedule' | 'deleteSchedule'
>;

/**
 * #3282 §4 part b-3: the Agents panel's "Scheduled" group. No `requestId` correlates
 * `get-background-tasks`/`background_tasks` (the message carries none — see `wire-messages.ts`), so
 * this owns that whole message type for the GUI: every reply is a full refresh of the roster,
 * filtered server-side to `kind: 'scheduled'` (the same tasks `/schedule list` shows).
 *
 * Pause/resume send the SAME `command` text `/schedule pause <id>` / `/schedule resume <id>` runs.
 * Delete sends the existing `cancel-background-task` write — the same one Stop already uses for any
 * other background-task kind (#3288/#3332) — since a schedule IS a background task, and cancelling
 * one is permanent (distinct from the reversible pause), matching #3282 §4's "Delete…" requirement.
 */
export function useSchedulesState(send: (msg: TClientMessage) => void): TSchedulesState & {
  /** Handles `background_tasks` and a `cancel` `background_task_control_result` — both refresh. */
  handleSchedulesMessage: (msg: TServerMessage) => boolean;
  requestSchedules: () => void;
} {
  const [scheduledTasks, setScheduledTasks] = useState<IWsSessionState['scheduledTasks']>([]);

  const requestSchedules = useCallback((): void => {
    send({ type: 'get-background-tasks', filter: { kind: 'scheduled' } });
  }, [send]);

  const handleSchedulesMessage = useCallback(
    (msg: TServerMessage): boolean => {
      if (msg.type === 'background_tasks') {
        // Defensive narrowing: the request already asked for `kind: 'scheduled'` only, but the wire
        // type carries the full union — this is the one place that turns "should be" into "is".
        setScheduledTasks(
          msg.tasks.filter(
            (task): task is IWsSessionState['scheduledTasks'][number] => task.kind === 'scheduled',
          ),
        );
        return true;
      }
      if (msg.type === 'background_task_control_result' && msg.action === 'cancel') {
        // A schedule's Delete — refresh so a successful cancel drops it from the group at once; a
        // refused one leaves the row exactly as it was (the central reducer's own case already
        // turns a failure into a plain-message session notice — #3288 §1 — so this never duplicates it).
        if (msg.success) requestSchedules();
        return false; // not exclusively ours — other future consumers may still want this event
      }
      if (msg.type === 'command_result' && msg.name === 'schedule' && msg.success) {
        // Pause/resume ran through the command path — refresh so the row's status/next-run follows.
        requestSchedules();
        return false; // the normal command-result handling (the conversation card) still applies
      }
      return false;
    },
    [requestSchedules],
  );

  const pauseSchedule = useCallback(
    (taskId: string): void => {
      send({ type: 'command', name: 'schedule', args: `pause ${taskId}` });
    },
    [send],
  );

  const resumeSchedule = useCallback(
    (taskId: string): void => {
      send({ type: 'command', name: 'schedule', args: `resume ${taskId}` });
    },
    [send],
  );

  const deleteSchedule = useCallback(
    (taskId: string): void => {
      send({ type: 'cancel-background-task', taskId });
    },
    [send],
  );

  return {
    scheduledTasks,
    pauseSchedule,
    resumeSchedule,
    deleteSchedule,
    handleSchedulesMessage,
    requestSchedules,
  };
}
