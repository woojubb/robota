/**
 * The goals a personal agent keeps and the feed it reports to: scheduling, status, runs with their
 * audit trail, and feed items. Running a goal is the host's job; this book is what the host and the
 * person's page both read and change, so they always agree on what is due, waiting or done.
 */
import { containsSensitiveMemoryContent } from '@robota-sdk/agent-framework';

import type {
  IFeedItem,
  IGoal,
  IGoalAction,
  IGoalRun,
  IGoalStore,
  TApprovalState,
  TGoalRunOutcome,
} from './types.js';

export interface IGoalBookOptions {
  readonly store: IGoalStore;
  readonly now?: () => Date;
}

export interface ICreateGoalInput {
  readonly title: string;
  readonly instructions: string;
  readonly everyMinutes?: number;
  readonly readOnly?: boolean;
}

export class GoalRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'GoalRefusedError';
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function slug(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40);
}

export class GoalBook {
  private readonly store: IGoalStore;
  private readonly now: () => Date;
  private sequence = 0;

  constructor(options: IGoalBookOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
  }

  private stamp(): string {
    return this.now().toISOString();
  }

  private mint(prefix: string): string {
    this.sequence += 1;
    return `${prefix}${this.now().getTime().toString(36)}${this.sequence.toString(36)}`;
  }

  private async require(id: string): Promise<IGoal> {
    const goal = await this.store.getGoal(id);
    if (goal === undefined) throw new GoalRefusedError(`No goal ${id}`);
    return goal;
  }

  private async save(
    goal: IGoal,
    patch: Partial<IGoal>,
    clear: readonly (keyof IGoal)[] = [],
  ): Promise<IGoal> {
    const next = { ...goal, ...patch, updatedAt: this.stamp() } as Record<string, unknown>;
    for (const key of clear) delete next[key];
    await this.store.putGoal(next as unknown as IGoal);
    return next as unknown as IGoal;
  }

  async create(input: ICreateGoalInput): Promise<IGoal> {
    const title = oneLine(input.title);
    const instructions = input.instructions.trim();
    if (title === '' || instructions === '')
      throw new GoalRefusedError('A goal needs a title and instructions');
    if (
      input.everyMinutes !== undefined &&
      (!Number.isInteger(input.everyMinutes) || input.everyMinutes < 1)
    ) {
      throw new GoalRefusedError('everyMinutes must be a whole number of at least 1');
    }
    if (containsSensitiveMemoryContent(title) || containsSensitiveMemoryContent(instructions)) {
      throw new GoalRefusedError('This looks like a secret and is not kept in a goal');
    }
    const at = this.stamp();
    const base = slug(title);
    const goal: IGoal = {
      id: `${base === '' ? 'goal' : base}-${this.mint('')}`,
      title,
      instructions,
      ...(input.everyMinutes !== undefined && { everyMinutes: input.everyMinutes }),
      readOnly: input.readOnly === true,
      status: 'active',
      nextRunAt: at,
      createdAt: at,
      updatedAt: at,
    };
    await this.store.putGoal(goal);
    return goal;
  }

  async list(): Promise<readonly IGoal[]> {
    return [...(await this.store.listGoals())].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async get(id: string): Promise<IGoal | undefined> {
    return this.store.getGoal(id);
  }

  async runs(goalId: string, limit = 20): Promise<readonly IGoalRun[]> {
    return this.store.listRuns(goalId, limit);
  }

  /** Goals due now: active and scheduled at or before this moment. */
  async due(): Promise<readonly IGoal[]> {
    const now = this.stamp();
    return (await this.store.listGoals())
      .filter(
        (goal) => goal.status === 'active' && goal.nextRunAt !== undefined && goal.nextRunAt <= now,
      )
      .sort((a, b) => (a.nextRunAt ?? '').localeCompare(b.nextRunAt ?? ''));
  }

  async pause(id: string): Promise<IGoal> {
    const goal = await this.require(id);
    if (goal.status === 'running' || goal.status === 'waiting')
      throw new GoalRefusedError('The goal is running; pause it after this run');
    return this.save(goal, { status: 'paused' }, ['nextRunAt']);
  }

  /** Make a paused, finished or failed goal due now. */
  async resume(id: string): Promise<IGoal> {
    const goal = await this.require(id);
    if (goal.status === 'running' || goal.status === 'waiting') return goal;
    return this.save(goal, { status: 'active', nextRunAt: this.stamp() });
  }

  async remove(id: string): Promise<void> {
    const goal = await this.require(id);
    if (goal.status === 'running' || goal.status === 'waiting')
      throw new GoalRefusedError('The goal is running; stop it after this run');
    await this.store.deleteGoal(id);
  }

  async startRun(goalId: string): Promise<IGoalRun> {
    const goal = await this.require(goalId);
    const at = this.stamp();
    const run: IGoalRun = { id: this.mint('run-'), goalId, startedAt: at, actions: [] };
    await this.store.putRun(run);
    await this.save(goal, { status: 'running', lastRunAt: at }, ['nextRunAt']);
    return run;
  }

  async recordAction(run: IGoalRun, action: Omit<IGoalAction, 'at'>): Promise<IGoalRun> {
    const next: IGoalRun = { ...run, actions: [...run.actions, { ...action, at: this.stamp() }] };
    await this.store.putRun(next);
    return next;
  }

  async setWaiting(goalId: string, waiting: boolean): Promise<void> {
    const goal = await this.require(goalId);
    await this.save(goal, { status: waiting ? 'waiting' : 'running' });
  }

  /** End a run, schedule the next one or close the goal, and report to the feed. */
  async finishRun(run: IGoalRun, outcome: TGoalRunOutcome, report: string): Promise<IGoalRun> {
    const goal = await this.require(run.goalId);
    const at = this.stamp();
    const finished: IGoalRun = { ...run, endedAt: at, outcome, report };
    await this.store.putRun(finished);
    if (goal.everyMinutes !== undefined) {
      const next = new Date(this.now().getTime() + goal.everyMinutes * 60_000).toISOString();
      await this.save(goal, { status: 'active', nextRunAt: next });
    } else {
      await this.save(goal, { status: outcome === 'done' ? 'done' : 'failed' }, ['nextRunAt']);
    }
    await this.post({
      kind: 'report',
      title: outcome === 'done' ? goal.title : `${goal.title} (${outcome})`,
      body: report,
      goalId: goal.id,
      runId: run.id,
    });
    return finished;
  }

  /**
   * After the host restarts, nothing is running: a goal it was running is due again, and an approval
   * it was waiting on can no longer be answered.
   */
  async recover(): Promise<number> {
    let recovered = 0;
    for (const goal of await this.store.listGoals()) {
      if (goal.status !== 'running' && goal.status !== 'waiting') continue;
      recovered += 1;
      await this.save(goal, { status: 'active', nextRunAt: this.stamp() });
      for (const run of await this.store.listRuns(goal.id, 1)) {
        if (run.endedAt === undefined)
          await this.store.putRun({ ...run, endedAt: this.stamp(), outcome: 'interrupted' });
      }
    }
    for (const item of await this.store.listFeed(500)) {
      if (item.approval?.state === 'pending') await this.setApproval(item.id, 'expired');
    }
    return recovered;
  }

  async post(item: Omit<IFeedItem, 'id' | 'at' | 'dismissed'>): Promise<IFeedItem> {
    const posted: IFeedItem = {
      ...item,
      id: this.mint('feed-'),
      at: this.stamp(),
      dismissed: false,
    };
    await this.store.putFeedItem(posted);
    return posted;
  }

  async feed(limit = 100): Promise<readonly IFeedItem[]> {
    return this.store.listFeed(limit);
  }

  async feedItem(id: string): Promise<IFeedItem | undefined> {
    return this.store.getFeedItem(id);
  }

  async setApproval(id: string, state: TApprovalState): Promise<IFeedItem> {
    const item = await this.store.getFeedItem(id);
    if (item?.approval === undefined) throw new GoalRefusedError(`No approval ${id}`);
    const next: IFeedItem = { ...item, approval: { ...item.approval, state } };
    await this.store.putFeedItem(next);
    return next;
  }

  async dismiss(id: string): Promise<void> {
    const item = await this.store.getFeedItem(id);
    if (item === undefined) throw new GoalRefusedError(`No feed item ${id}`);
    if (item.approval?.state === 'pending')
      throw new GoalRefusedError('Answer the approval before dismissing it');
    await this.store.putFeedItem({ ...item, dismissed: true });
  }
}
