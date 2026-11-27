/**
 * How a goal that keeps a connector in sync is run and reported: what the run is told, which tools it
 * has, and whether it is worth the person's attention. The goal machinery is the ordinary one; this
 * is the part that knows about connectors.
 */
import {
  countPulled,
  createSyncProgressTool,
  syncRunInstructions,
  syncRunTools,
} from '@robota-sdk/agent-product/personal';

import type {
  CaseBook,
  ConnectorBook,
  ConnectorRegistry,
  GoalBook,
  IGoal,
  IGoalRun,
  ISyncProgressReport,
  KnowledgeWiki,
  TSyncProgressAnswer,
} from '@robota-sdk/agent-product/personal';
import type { IGoalShape } from '../goal-runner.js';
import type { ISyncProgressStore } from './sync-progress.js';
import type { IOfferService } from '../task-catalog/offers/service.js';

/** How many of a goal's latest runs are looked through for the last one that confirmed its reading. */
const RUNS_LOOKED_AT = 100;
/** The first run looks this far back, since there is no earlier point to start from. */
const FIRST_RUN_DAYS = 7;
/**
 * A run starts this far before the point the last one confirmed. A service can show an item some time
 * after its receipt time, a sync runs at least a quarter of an hour apart and filing is keyed by the
 * item's reference, so reading a little again costs nothing and skipping a late item would.
 */
export const SYNC_OVERLAP_MINUTES = 10;
/** A reported time may not be later than this far ahead of the host's clock. */
const FUTURE_SLACK_MINUTES = 5;
const ISO_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/u;

export interface ISyncRuns {
  shape(goal: IGoal, run: IGoalRun): Promise<IGoalShape | undefined>;
  quiet(goal: IGoal): Promise<boolean>;
}

export function createSyncRuns(options: {
  readonly book: ConnectorBook;
  readonly registry: ConnectorRegistry;
  readonly goals: GoalBook;
  readonly wiki: KnowledgeWiki;
  /** The agent's cases: a run that opens some has told the person through their question cards. */
  readonly cases: CaseBook;
  /** What runs confirmed they read, kept by the host. */
  readonly progress: ISyncProgressStore;
  readonly now?: () => Date;
  /** The offers a run may propose: its own tool with the run's bounds, and what the run is told about it. */
  readonly offers?: Pick<IOfferService, 'runTools' | 'instructions'>;
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

  const now = options.now ?? (() => new Date());
  const minutesBefore = (iso: string, minutes: number): string =>
    new Date(Date.parse(iso) - minutes * 60_000).toISOString();

  /**
   * Where a run starts reading: the point the newest finished run confirmed, a little before it. A run
   * that failed, was cut short or ended without a confirmation the host accepted may not have covered
   * what it was started for, so it does not move the start. A run that confirmed it reached the end
   * covered everything it could see when it began; one that stopped at the limit covered up to where
   * it said. Before any run has confirmed, the start is the one it was before runs confirmed anything:
   * when the last run that finished well began.
   */
  const startOfCoverage = async (goal: IGoal): Promise<string | undefined> => {
    const done = (await options.goals.runs(goal.id, RUNS_LOOKED_AT)).filter(
      (run) => run.outcome === 'done',
    );
    for (const run of done) {
      const entry = options.progress
        .list(goal.connectorId ?? '')
        .filter((candidate) => candidate.runId === run.id)
        .at(-1);
      if (entry === undefined) continue;
      const point = entry.complete ? run.startedAt : entry.through;
      if (point !== undefined) return minutesBefore(point, SYNC_OVERLAP_MINUTES);
    }
    return done[0]?.startedAt;
  };

  /** The tool this run ends with, bound to it: what it reports is checked against this run's own start. */
  const progressTool = (goal: IGoal, run: IGoalRun, start: string) =>
    createSyncProgressTool({
      async record(report: ISyncProgressReport): Promise<TSyncProgressAnswer> {
        if (report.connector !== goal.connectorId) {
          return { recorded: false, reason: 'This run reads another connector.' };
        }
        let through: string | undefined;
        if (report.through !== undefined) {
          const time = Date.parse(report.through);
          if (!ISO_TIME.test(report.through) || Number.isNaN(time)) {
            return {
              recorded: false,
              reason: '`through` must be a UTC time such as 2026-01-31T09:00:00Z.',
            };
          }
          if (time < Date.parse(start)) {
            return {
              recorded: false,
              reason: '`through` is before the time this run started reading from.',
            };
          }
          if (time > now().getTime() + FUTURE_SLACK_MINUTES * 60_000) {
            return { recorded: false, reason: '`through` is in the future.' };
          }
          through = new Date(time).toISOString();
        } else if (!report.complete) {
          return {
            recorded: false,
            reason: 'Say through which time you read, or that you read to the end.',
          };
        }
        options.progress.record(report.connector, {
          runId: run.id,
          ...(through !== undefined && { through }),
          complete: report.complete,
          at: now().toISOString(),
        });
        return { recorded: true };
      },
    });

  return {
    async shape(goal, run) {
      if (goal.connectorId === undefined) return undefined;
      const connector = await options.book.get(goal.connectorId);
      atStart.set(goal.id, {
        held: await countPulled(options.wiki, goal.connectorId),
        cases: await casesOf(goal.connectorId),
        reads: options.registry.readCounts(goal.connectorId),
      });
      if (connector === undefined)
        return {
          instructions: 'Its connector no longer exists. Say so in one line and do nothing else.',
          onlyTools: syncRunTools(),
        };
      const since = await startOfCoverage(goal);
      const instructions = syncRunInstructions(connector, since);
      return {
        instructions:
          options.offers === undefined
            ? instructions
            : [instructions, await options.offers.instructions()].join('\n'),
        onlyTools: syncRunTools(),
        scopedTools: [
          progressTool(goal, run, since ?? minutesBefore(run.startedAt, FIRST_RUN_DAYS * 1440)),
          ...(options.offers?.runTools() ?? []),
        ],
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
