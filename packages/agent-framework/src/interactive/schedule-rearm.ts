/**
 * SELFHOST-012 — the single re-arm predicate for restored scheduled tasks, shared by the restore
 * reconciliation (`interactive-session-restore.ts`) and the tracker re-arm (`interactive-session-background-tracker.ts`).
 *
 * These two paths MUST agree byte-for-byte: if restore keeps a task the tracker won't re-arm (or vice-versa) a
 * schedule becomes a zombie — kept-but-never-fires, or re-armed-then-reconciled-to-failed. Owning one predicate
 * removes that divergence risk (review CONSIDER).
 */

import type { IBackgroundTaskState } from '@robota-sdk/agent-interface-transport';

/**
 * A restored scheduled task that can be re-armed from its persisted schedule: a `sleeping` one re-arms to fire
 * again, and a `paused` one re-arms but is kept paused (the tracker re-spawns then immediately pauses). Both are
 * kept rather than reconciled to `failed` as a stale worker.
 */
export function isReArmableScheduledTask(task: IBackgroundTaskState): boolean {
  return (
    task.kind === 'scheduled' &&
    (task.status === 'sleeping' || task.status === 'paused') &&
    task.schedule !== undefined
  );
}
