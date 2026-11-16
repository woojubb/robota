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
  IQuestionAnswer,
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
  readonly connectorId?: string;
  readonly caseId?: string;
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
      ...(input.connectorId !== undefined && { connectorId: input.connectorId }),
      ...(input.caseId !== undefined && { caseId: input.caseId }),
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

  /**
   * Change how often a goal repeats. A run in progress keeps going and the next one follows the new
   * interval; otherwise the goal is active again and due that long after its last run (at once if it
   * never ran or that moment has passed).
   */
  async reschedule(id: string, everyMinutes: number): Promise<IGoal> {
    if (!Number.isInteger(everyMinutes) || everyMinutes < 1) {
      throw new GoalRefusedError('everyMinutes must be a whole number of at least 1');
    }
    const goal = await this.require(id);
    if (goal.status === 'running' || goal.status === 'waiting') {
      return this.save(goal, { everyMinutes });
    }
    const last = goal.lastRunAt === undefined ? undefined : new Date(goal.lastRunAt).getTime();
    const due = last === undefined ? this.now().getTime() : last + everyMinutes * 60_000;
    return this.save(goal, {
      everyMinutes,
      status: 'active',
      nextRunAt: new Date(due).toISOString(),
    });
  }

  /** Make a paused, finished or failed goal due now. */
  async resume(id: string): Promise<IGoal> {
    const goal = await this.require(id);
    if (goal.status === 'running' || goal.status === 'waiting') return goal;
    return this.save(goal, { status: 'active', nextRunAt: this.stamp() });
  }

  /**
   * Make a goal that has finished due now again, as a one-shot goal's next turn: a case's goal runs once
   * for each answer. A goal still running or waiting is refused, since a second run would start before
   * the first ended, and so is a paused one, which the person stopped; `resume` is for them. The interval
   * is untouched, so a scheduled goal follows its own schedule again once the extra run ends.
   */
  async runAgain(id: string): Promise<IGoal> {
    const goal = await this.require(id);
    if (goal.status === 'running' || goal.status === 'waiting')
      throw new GoalRefusedError('The goal is running; run it again after this run');
    if (goal.status === 'paused')
      throw new GoalRefusedError('The goal is paused; resume it to run it again');
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
  /**
   * End a run. A `quiet` run that went well is kept in the goal's history but is not posted to the
   * feed, so a goal that mostly finds nothing does not fill it; a run that did not go well is posted.
   */
  async finishRun(
    run: IGoalRun,
    outcome: TGoalRunOutcome,
    report: string,
    options: { readonly quiet?: boolean } = {},
  ): Promise<IGoalRun> {
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
    if (options.quiet === true && outcome === 'done') return finished;
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

  /** Record the person's answer to a question; a question is answered once. */
  async answerQuestion(id: string, answer: Omit<IQuestionAnswer, 'at'>): Promise<IFeedItem> {
    const item = await this.store.getFeedItem(id);
    if (item?.question === undefined) throw new GoalRefusedError(`No question ${id}`);
    if (item.question.state !== 'open')
      throw new GoalRefusedError('This question is no longer waiting for an answer');
    const next: IFeedItem = {
      ...item,
      question: { ...item.question, state: 'answered', answer: { ...answer, at: this.stamp() } },
    };
    await this.store.putFeedItem(next);
    return next;
  }

  /** Show how the case closed under the person's answer; only an answered question carries one. */
  async resolveQuestion(id: string, resolution: string): Promise<IFeedItem> {
    const item = await this.store.getFeedItem(id);
    if (item?.question === undefined) throw new GoalRefusedError(`No question ${id}`);
    if (item.question.state !== 'answered')
      throw new GoalRefusedError('Only an answered question shows a resolution');
    const next: IFeedItem = { ...item, question: { ...item.question, resolution } };
    await this.store.putFeedItem(next);
    return next;
  }

  /** A question whose case closed before the person answered it can no longer be answered. */
  async withdrawQuestion(id: string): Promise<IFeedItem> {
    const item = await this.store.getFeedItem(id);
    if (item?.question === undefined) throw new GoalRefusedError(`No question ${id}`);
    const next: IFeedItem = { ...item, question: { ...item.question, state: 'withdrawn' } };
    await this.store.putFeedItem(next);
    return next;
  }

  async dismiss(id: string): Promise<void> {
    const item = await this.store.getFeedItem(id);
    if (item === undefined) throw new GoalRefusedError(`No feed item ${id}`);
    if (item.approval?.state === 'pending')
      throw new GoalRefusedError('Answer the approval before dismissing it');
    if (item.question?.state === 'open')
      throw new GoalRefusedError('Answer the question before dismissing it');
    await this.store.putFeedItem({ ...item, dismissed: true });
  }
}
