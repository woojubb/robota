/** A goal store held in memory: for tests, and for a host that keeps state elsewhere. */
import type { IFeedItem, IGoal, IGoalRun, IGoalStore } from './types.js';

const newestFirst = <T extends { readonly id: string }>(
  items: Iterable<T>,
  at: (item: T) => string,
): T[] => [...items].sort((a, b) => at(b).localeCompare(at(a)) || b.id.localeCompare(a.id));

export function createMemoryGoalStore(): IGoalStore {
  const goals = new Map<string, IGoal>();
  const runs = new Map<string, IGoalRun>();
  const feed = new Map<string, IFeedItem>();
  return {
    listGoals: async () => [...goals.values()],
    getGoal: async (id) => goals.get(id),
    putGoal: async (goal) => {
      goals.set(goal.id, goal);
    },
    deleteGoal: async (id) => {
      goals.delete(id);
      for (const [runId, run] of runs) if (run.goalId === id) runs.delete(runId);
    },
    putRun: async (run) => {
      runs.set(run.id, run);
    },
    listRuns: async (goalId, limit) =>
      newestFirst(
        [...runs.values()].filter((run) => run.goalId === goalId),
        (run) => run.startedAt,
      ).slice(0, limit),
    putFeedItem: async (item) => {
      feed.set(item.id, item);
    },
    getFeedItem: async (id) => feed.get(id),
    listFeed: async (limit) => newestFirst(feed.values(), (item) => item.at).slice(0, limit),
  };
}
