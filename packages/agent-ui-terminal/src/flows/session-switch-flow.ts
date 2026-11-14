/**
 * Whether the terminal may stop the session the person is on to open another that they picked.
 *
 * The new session claims its record while its channel is built, which is after the running one has
 * been stopped, so a claim the store refuses would leave the person with no session. A held id is
 * therefore asked about first, and refused in the store's own words while everything is still running.
 *
 * Stopping the session also cancels the background jobs it still runs, so a switch that would do that
 * is asked about too, with the same count and wording wherever the switch starts.
 */

import { claimRefusalMessage, liveBackgroundJobCount } from '@robota-sdk/agent-framework';

import type { IExecutionWorkspaceSnapshot } from '@robota-sdk/agent-interface/execution';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface/session';

/** What the person is told when they decline: they are where they were, with their jobs running. */
export const JOBS_RUNNING_NOT_SWITCHED_NOTICE =
  'Background jobs are still running; session not switched.';

/** A switch away keeps no entry of the session it leaves, so every job that has not ended is stopped. */
const NO_ENTRY_KEPT = '';

/** How many jobs stopping the session with this workspace would cancel. */
export function liveJobsStoppedBySwitch(snapshot: IExecutionWorkspaceSnapshot | null): number {
  return liveBackgroundJobCount(snapshot, NO_ENTRY_KEPT);
}

/** The fact the person is asked to accept, worded once for every switch that would stop jobs. */
export function stopJobsNotice(count: number): string {
  return `${count} background ${count === 1 ? 'job is' : 'jobs are'} still running and will be stopped.`;
}

/**
 * The store's words for refusing to open `sessionId` while another writer holds it, or `undefined`
 * when it can be opened. The session the person is on holds its own id and is reopened by picking it
 * again, so that is never refused. The store's only answer that names the holder is a refused claim,
 * so one is made when the id has a writer, which refuses without taking anything; an id that went free
 * since is let go again at once.
 */
export function refusalBeforeStop(
  store: IInteractiveSessionStore | undefined,
  sessionId: string,
  currentSessionId: string,
): string | undefined {
  if (store === undefined || sessionId === currentSessionId || !store.hasWriter(sessionId)) {
    return undefined;
  }
  try {
    store.claim(sessionId).release();
  } catch (error) {
    const refusal = claimRefusalMessage(error);
    if (refusal === undefined) throw error;
    return refusal;
  }
  return undefined;
}
