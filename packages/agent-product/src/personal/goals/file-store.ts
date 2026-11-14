/**
 * A goal store in an owner-only directory: `goals.json` and `feed.json`, each rewritten atomically,
 * and one `runs/<goal>.json` per goal holding its recent runs. The feed and each goal's run history
 * keep a bounded number of entries, so an agent that runs for years does not grow without limit.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { IFeedItem, IGoal, IGoalRun, IGoalStore } from './types.js';

const GOAL_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const FEED_ID = /^feed-[a-z0-9]{1,40}$/;
const FEED_LIMIT = 500;
const RUNS_PER_GOAL = 100;

function readJson<T>(path: string, empty: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : empty;
}

function writeAtomic(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

const newestFirst = <T extends { readonly id: string }>(items: T[], at: (item: T) => string): T[] =>
  items.sort((a, b) => at(b).localeCompare(at(a)) || b.id.localeCompare(a.id));

/** A record's own entry only: an id such as `constructor` must not reach the object's prototype. */
function own<T>(map: Record<string, T>, id: string): T | undefined {
  return Object.hasOwn(map, id) ? map[id] : undefined;
}

/** The newest feed items up to the bound, never dropping an approval still waiting for an answer. */
function boundedFeed(items: IFeedItem[]): IFeedItem[] {
  const sorted = newestFirst(items, (item) => item.at);
  const waiting = sorted.filter((item) => item.approval?.state === 'pending');
  const rest = sorted
    .filter((item) => item.approval?.state !== 'pending')
    .slice(0, Math.max(0, FEED_LIMIT - waiting.length));
  return newestFirst([...waiting, ...rest], (item) => item.at);
}

export function createFileGoalStore(directory: string): IGoalStore {
  mkdirSync(join(directory, 'runs'), { recursive: true, mode: 0o700 });
  const goalsPath = join(directory, 'goals.json');
  const feedPath = join(directory, 'feed.json');
  const runsPath = (goalId: string): string => {
    if (!GOAL_ID.test(goalId)) throw new Error(`Invalid goal id: ${goalId}`);
    return join(directory, 'runs', `${goalId}.json`);
  };
  const goals = (): Record<string, IGoal> => readJson(goalsPath, {});
  const feed = (): Record<string, IFeedItem> => readJson(feedPath, {});

  return {
    listGoals: async () => Object.values(goals()),
    getGoal: async (id) => own(goals(), id),
    putGoal: async (goal) => {
      if (!GOAL_ID.test(goal.id)) throw new Error(`Invalid goal id: ${goal.id}`);
      writeAtomic(goalsPath, { ...goals(), [goal.id]: goal });
    },
    deleteGoal: async (id) => {
      const { [id]: _removed, ...rest } = goals();
      writeAtomic(goalsPath, rest);
      rmSync(runsPath(id), { force: true });
    },
    putRun: async (run) => {
      const path = runsPath(run.goalId);
      const runs = readJson<IGoalRun[]>(path, []).filter((existing) => existing.id !== run.id);
      writeAtomic(
        path,
        newestFirst([...runs, run], (item) => item.startedAt).slice(0, RUNS_PER_GOAL),
      );
    },
    listRuns: async (goalId, limit) => readJson<IGoalRun[]>(runsPath(goalId), []).slice(0, limit),
    putFeedItem: async (item) => {
      if (!FEED_ID.test(item.id)) throw new Error(`Invalid feed item id: ${item.id}`);
      const items = boundedFeed(Object.values({ ...feed(), [item.id]: item }));
      writeAtomic(feedPath, Object.fromEntries(items.map((entry) => [entry.id, entry])));
    },
    getFeedItem: async (id) => own(feed(), id),
    listFeed: async (limit) =>
      newestFirst(Object.values(feed()), (item) => item.at).slice(0, limit),
  };
}
