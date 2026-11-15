/**
 * How a goal that keeps a connector in sync is run and reported: what the run is told, which tools it
 * has, and whether it is worth the person's attention. The goal machinery is the ordinary one; this
 * is the part that knows about connectors.
 */
import {
  CONNECTOR_TOOL_NAMES,
  countPulled,
  syncRunInstructions,
  syncRunTools,
} from '@robota-sdk/agent-product/personal';

import type {
  ConnectorBook,
  ConnectorRegistry,
  GoalBook,
  IGoal,
  IGoalRun,
  KnowledgeWiki,
} from '@robota-sdk/agent-product/personal';
import type { IGoalShape } from '../goal-runner.js';

export interface ISyncRuns {
  shape(goal: IGoal): Promise<IGoalShape | undefined>;
  quiet(goal: IGoal, run: IGoalRun): Promise<boolean>;
}

export function createSyncRuns(options: {
  readonly book: ConnectorBook;
  readonly registry: ConnectorRegistry;
  readonly goals: GoalBook;
  readonly wiki: KnowledgeWiki;
}): ISyncRuns {
  /** How many claims the library held from a connector when its run began. */
  const heldAtStart = new Map<string, number>();

  /**
   * Where a run starts reading: when the last run that finished well began. A run that failed or was
   * cut short may not have covered what it was started for, so it does not move the start.
   */
  const startOfCoverage = async (goal: IGoal): Promise<string | undefined> =>
    (await options.goals.runs(goal.id)).find((run) => run.outcome === 'done')?.startedAt;

  return {
    async shape(goal) {
      if (goal.connectorId === undefined) return undefined;
      const connector = await options.book.get(goal.connectorId);
      heldAtStart.set(goal.id, await countPulled(options.wiki, goal.connectorId));
      return {
        instructions:
          connector === undefined
            ? 'Its connector no longer exists. Say so in one line and do nothing else.'
            : syncRunInstructions(connector, await startOfCoverage(goal)),
        onlyTools: syncRunTools(),
      };
    },

    /**
     * A sync has nothing to tell the person when the service is reachable, every read worked and the
     * run added nothing to the library: its run stays in the goal's history only. A run that could not
     * read, or whose connection is gone, is reported.
     */
    async quiet(goal, run) {
      const connectorId = goal.connectorId;
      if (connectorId === undefined) return false;
      const held = heldAtStart.get(goal.id) ?? 0;
      heldAtStart.delete(goal.id);
      // A connector that is gone is reported too, whatever the registry answers for it.
      if ((await options.book.get(connectorId)) === undefined) return false;
      const view = await options.registry.view(connectorId).catch(() => undefined);
      if (view === undefined || view.status.state !== 'connected') return false;
      const unread = run.actions.some(
        (action) =>
          (action.tool === CONNECTOR_TOOL_NAMES.read ||
            action.tool === CONNECTOR_TOOL_NAMES.list) &&
          action.outcome !== 'done',
      );
      if (unread) return false;
      return (await countPulled(options.wiki, connectorId)) <= held;
    },
  };
}
