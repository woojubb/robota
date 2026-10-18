/**
 * SELFHOST-012 — the single re-arm predicate for restored scheduled tasks, shared by the restore
 * reconciliation (`interactive-session-restore.ts`) and the tracker re-arm (`interactive-session-background-tracker.ts`).
 *
 * These two paths MUST agree byte-for-byte: if restore keeps a task the tracker won't re-arm (or vice-versa) a
 * schedule becomes a zombie — kept-but-never-fires, or re-armed-then-reconciled-to-failed. Owning one predicate
 * removes that divergence risk (review CONSIDER).
 */

import { sessionLoopBlockReason } from './session-loop-lifecycle.js';

import type { IBackgroundTaskState } from '@robota-sdk/agent-interface-execution';

/**
 * A restored scheduled task that can be re-armed from its persisted schedule: a `sleeping` one re-arms to fire
 * again, and a `paused` one re-arms but is kept paused (the tracker re-spawns then immediately pauses). Both are
 * kept rather than reconciled to `failed` as a stale worker.
 */
export function isReArmableScheduledTask(
  task: IBackgroundTaskState,
): task is IBackgroundTaskState<'scheduled'> {
  return (
    task.kind === 'scheduled' &&
    (task.status === 'sleeping' || task.status === 'paused') &&
    task.schedule !== undefined
  );
}

/**
 * What restoring a session does with one stored background task:
 * - `ignore`: it is not re-armed from its schedule (finished, not scheduled, no stored schedule, or
 *   a self-paced loop, which its own durable state resumes);
 * - `expired` / `disabled`: a session loop restore holds back rather than re-arm;
 * - `rearm-paused`: it is re-armed and paused again at once, so it fires only when a person resumes it;
 * - `rearm`: it is re-armed and fires on its schedule.
 */
export type TRestoredScheduleDisposition =
  | 'ignore'
  | 'expired'
  | 'disabled'
  | 'rearm-paused'
  | 'rearm';

/**
 * The one rule for what restore does with a stored scheduled task. The background tracker re-arms by
 * it, and a host that must know whether loading a stored session would start work on its own (the
 * editor-facing ACP load) asks it too, so the two cannot disagree: only `rearm` runs unattended.
 */
export function restoredScheduleDisposition(
  task: IBackgroundTaskState,
  nowMs: number,
  sessionLoopsDisabled: boolean,
): TRestoredScheduleDisposition {
  if (!isReArmableScheduledTask(task)) return 'ignore';
  if (task.metadata?.['sessionLoopSelfPaced'] === true) return 'ignore';
  const blocked = sessionLoopBlockReason(task, nowMs, sessionLoopsDisabled);
  if (blocked) return blocked;
  return task.status === 'paused' ? 'rearm-paused' : 'rearm';
}
