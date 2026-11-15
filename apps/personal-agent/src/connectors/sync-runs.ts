/**
 * How a goal that keeps a connector in sync is run and reported: what the run is told, which tools it
 * has, and whether it is worth the person's attention. The goal machinery is the ordinary one; this
 * is the part that knows about connectors.
 */
import { countPulled, syncRunInstructions, syncRunTools } from '@robota-sdk/agent-product/personal';

import type {
  CaseBook,
  ConnectorBook,
  ConnectorRegistry,
  GoalBook,
  IGoal,
  KnowledgeWiki,
} from '@robota-sdk/agent-product/personal';
import type { IGoalShape } from '../goal-runner.js';

/** How many of a goal's latest runs are looked through for the last one that finished well. */
const RUNS_LOOKED_AT = 100;

export interface ISyncRuns {
  shape(goal: IGoal): Promise<IGoalShape | undefined>;
  quiet(goal: IGoal): Promise<boolean>;
}

export function createSyncRuns(options: {
  readonly book: ConnectorBook;
  readonly registry: ConnectorRegistry;
  readonly goals: GoalBook;
  readonly wiki: KnowledgeWiki;
  /** The agent's cases: a run that opens some has told the person through their question cards. */
  readonly cases: CaseBook;
}): ISyncRuns {
  /**
   * What a connector held, which of its cases existed and how its reads stood when its run began, to
   * tell what the run did.
   */
  const atStart = new Map<
    string,
    {
      held: number;
      cases: ReadonlySet<string>;
      reads: { readonly succeeded: number; readonly failed: number };
    }
  >();

  /** The ids of every case that came from this connector, open or closed. */
  const casesOf = async (connectorId: string): Promise<ReadonlySet<string>> => {
    const all = await options.cases.list(Number.POSITIVE_INFINITY);
    return new Set(
      all.filter((found) => found.origin.connectorId === connectorId).map((found) => found.id),
    );
  };

  /**
   * Where a run starts reading: when the last run that finished well began. A run that failed or was
   * cut short may not have covered what it was started for, so it does not move the start.
   */
  const startOfCoverage = async (goal: IGoal): Promise<string | undefined> =>
    (await options.goals.runs(goal.id, RUNS_LOOKED_AT)).find((run) => run.outcome === 'done')
      ?.startedAt;

  return {
    async shape(goal) {
      if (goal.connectorId === undefined) return undefined;
      const connector = await options.book.get(goal.connectorId);
      atStart.set(goal.id, {
        held: await countPulled(options.wiki, goal.connectorId),
        cases: await casesOf(goal.connectorId),
        reads: options.registry.readCounts(goal.connectorId),
      });
      return {
        instructions:
          connector === undefined
            ? 'Its connector no longer exists. Say so in one line and do nothing else.'
            : syncRunInstructions(connector, await startOfCoverage(goal)),
        onlyTools: syncRunTools(),
      };
    },

    /**
     * A sync has nothing to tell the person when the service is reachable, no read failed, it did
     * something worth the read (it was read at least once, or it opened a case) and the run added
     * nothing to the library: its run stays in the goal's history only. A case it opened is already
     * the message, as a question card in the feed, so a report on top of it would say the same thing
     * twice. A run that read nothing and opened nothing, whose reads failed or whose connection is
     * gone is reported, so a broken sync is never silent.
     */
    async quiet(goal) {
      const connectorId = goal.connectorId;
      if (connectorId === undefined) return false;
      const start = atStart.get(goal.id);
      atStart.delete(goal.id);
      if (start === undefined) return false;
      // A connector that is gone is reported too, whatever the registry answers for it.
      if ((await options.book.get(connectorId)) === undefined) return false;
      const view = await options.registry.view(connectorId).catch(() => undefined);
      if (view === undefined || view.status.state !== 'connected') return false;
      const reads = options.registry.readCounts(connectorId);
      if (reads.failed > start.reads.failed) return false;
      const opened = [...(await casesOf(connectorId))].some((id) => !start.cases.has(id));
      if (reads.succeeded <= start.reads.succeeded && !opened) return false;
      return (await countPulled(options.wiki, connectorId)) <= start.held;
    },
  };
}
