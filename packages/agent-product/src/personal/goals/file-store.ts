/**
 * A goal store in an owner-only directory: `goals.json` and `feed.json`, each rewritten atomically,
 * and one `runs/<goal>.json` per goal holding its recent runs. The feed and each goal's run history
 * keep a bounded number of entries, so an agent that runs for years does not grow without limit.
 * A host must serialize reads and writes when multiple processes share this directory.
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import type { IFeedItem, IGoal, IGoalRun, IGoalStore } from './types.js';

const GOAL_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const FEED_ID = /^feed-[a-z0-9]{1,40}$/;
const FEED_LIMIT = 500;
const RUNS_PER_GOAL = 100;

function syncDirectory(path: string): void {
  if (process.platform === 'win32') return;
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function readJson<T>(path: string, empty: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : empty;
}

function writeAtomic(path: string, value: unknown, durable = false): void {
  const temporary = `${path}.${process.pid}.tmp`;
  if (durable) {
    const fd = openSync(temporary, 'w', 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } else {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  }
  renameSync(temporary, path);
  if (durable) syncDirectory(dirname(path));
}

const newestFirst = <T extends { readonly id: string }>(items: T[], at: (item: T) => string): T[] =>
  items.sort((a, b) => at(b).localeCompare(at(a)) || b.id.localeCompare(a.id));

/** A record's own entry only: an id such as `constructor` must not reach the object's prototype. */
function own<T>(map: Record<string, T>, id: string): T | undefined {
  return Object.hasOwn(map, id) ? map[id] : undefined;
}

/** An approval or a question still waiting for an answer. */
const isWaiting = (item: IFeedItem): boolean =>
  item.approval?.state === 'pending' || item.question?.state === 'open';

/** The newest feed items up to the bound, never dropping one still waiting for an answer. */
function boundedFeed(items: IFeedItem[]): IFeedItem[] {
  const sorted = newestFirst(items, (item) => item.at);
  const waiting = sorted.filter(isWaiting);
  const rest = sorted
    .filter((item) => !isWaiting(item))
    .slice(0, Math.max(0, FEED_LIMIT - waiting.length));
  return newestFirst([...waiting, ...rest], (item) => item.at);
}

export function createFileGoalStore(directory: string): IGoalStore {
  const created: string[] = [];
  for (let path = directory; !existsSync(path); path = dirname(path)) created.push(path);
  mkdirSync(join(directory, 'runs'), { recursive: true, mode: 0o700 });
  for (const path of created) syncDirectory(dirname(path));
  const goalsPath = join(directory, 'goals.json');
  const feedPath = join(directory, 'feed.json');
  const feedRecoveryPath = join(directory, 'feed-recovery.json');
  const feedCommitPath = join(directory, 'feed-commit-uncertain.json');
  let failedCommit = false;
  let knownCommit = false;
  const runsPath = (goalId: string): string => {
    if (!GOAL_ID.test(goalId)) throw new Error(`Invalid goal id: ${goalId}`);
    return join(directory, 'runs', `${goalId}.json`);
  };
  const goals = (): Record<string, IGoal> => readJson(goalsPath, {});
  const restoreFeed = (path: string): void => {
    const recovery = readJson<unknown>(path, undefined);
    if (typeof recovery !== 'object' || recovery === null || Array.isArray(recovery))
      throw new Error('The feed recovery record is invalid');
    const previous = (recovery as { previous?: unknown }).previous;
    if (typeof previous !== 'object' || previous === null || Array.isArray(previous))
      throw new Error('The feed recovery record is invalid');
    writeAtomic(feedPath, previous, true);
    rmSync(path);
    syncDirectory(directory);
  };
  const recoverFeed = (): void => {
    if (existsSync(feedCommitPath)) {
      if (failedCommit) {
        restoreFeed(feedCommitPath);
        failedCommit = false;
      } else if (knownCommit) {
        rmSync(feedCommitPath);
        knownCommit = false;
      } else {
        throw new Error(
          'The feed commit outcome is uncertain; stop all agents and recover the state folder',
        );
      }
    }
    if (existsSync(feedRecoveryPath)) restoreFeed(feedRecoveryPath);
  };
  const feed = (): Record<string, IFeedItem> => {
    recoverFeed();
    return readJson(feedPath, {});
  };

  return {
    ...(process.platform === 'win32' ? {} : { durableFeedWrites: true as const }),
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
      const previous = feed();
      const items = boundedFeed(Object.values({ ...previous, [item.id]: item }));
      const next = Object.fromEntries(items.map((entry) => [entry.id, entry]));
      const waitingPost = !Object.hasOwn(previous, item.id) && isWaiting(item);
      if (waitingPost) writeAtomic(feedRecoveryPath, { previous }, true);
      try {
        writeAtomic(feedPath, next, true);
        if (waitingPost) {
          renameSync(feedRecoveryPath, feedCommitPath);
          failedCommit = true;
          syncDirectory(directory);
          failedCommit = false;
          knownCommit = true;
          try {
            rmSync(feedCommitPath);
            knownCommit = false;
          } catch {
            // A confirmed commit remains closed to other hosts until cleanup succeeds.
          }
        }
      } catch (error) {
        try {
          if (existsSync(feedRecoveryPath) || (failedCommit && existsSync(feedCommitPath)))
            recoverFeed();
          else if (JSON.stringify(readJson(feedPath, {})) === JSON.stringify(next))
            writeAtomic(feedPath, previous, true);
        } catch {
          // Retain the recovery record until the feed can be restored.
        }
        throw error;
      }
    },
    getFeedItem: async (id) => own(feed(), id),
    listFeed: async (limit) =>
      newestFirst(Object.values(feed()), (item) => item.at).slice(0, limit),
  };
}
