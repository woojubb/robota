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
  /** Serialize goal and run mutations across hosts sharing the store. */
  readonly withWriteLock?: <T>(work: () => Promise<T>) => Promise<T>;
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
  /** This book allocates feed identifiers independently across host processes. */
  readonly usesUniqueFeedIds = true as const;
  readonly supportsSharedGoalLock = true as const;
  readonly supportsCaseAnswerQueue = true as const;

  private readonly store: IGoalStore;
  private readonly now: () => Date;
  private readonly withWriteLock: IGoalBookOptions['withWriteLock'];
  private tail: Promise<unknown> = Promise.resolve();
  private sequence = 0;

  constructor(options: IGoalBookOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.withWriteLock = options.withWriteLock;
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(() =>
      this.withWriteLock === undefined ? work() : this.withWriteLock(work),
    );
    this.tail = run.catch(() => undefined);
    return run;
  }

  private stamp(): string {
    return this.now().toISOString();
  }

  private mint(prefix: string): string {
    this.sequence += 1;
    const order = (this.sequence % 36 ** 6).toString(36).padStart(6, '0');
    return `${prefix}${order}${crypto.randomUUID().replaceAll('-', '')}`;
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

  create(input: ICreateGoalInput): Promise<IGoal> {
    return this.exclusive(() => this.createUnlocked(input));
  }

  private async createUnlocked(
    input: ICreateGoalInput,
    pendingCaseAnswer?: IGoal['pendingCaseAnswer'],
  ): Promise<IGoal> {
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
      ...(pendingCaseAnswer !== undefined && { pendingCaseAnswer }),
      status: 'active',
      nextRunAt: at,
      createdAt: at,
      updatedAt: at,
    };
    await this.store.putGoal(goal);
    return goal;
  }

  /** Queue one answer for the agent holding its answer-time authority. */
  enqueueCaseAnswer(input: {
    readonly caseId: string;
    readonly feedItemId: string;
    readonly ownerId: string;
    readonly title: string;
    readonly instructions: string;
  }): Promise<IGoal> {
    return this.exclusive(async () => {
      const pendingCaseAnswer = { feedItemId: input.feedItemId, ownerId: input.ownerId };
      const goal = (await this.store.listGoals()).find((item) => item.caseId === input.caseId);
      if (goal === undefined)
        return this.createUnlocked(
          {
            title: input.title,
            instructions: input.instructions,
            caseId: input.caseId,
            readOnly: true,
          },
          pendingCaseAnswer,
        );
      if (
        goal.pendingCaseAnswer?.feedItemId === input.feedItemId ||
        goal.lastCaseAnswerId === input.feedItemId
      )
        return goal;
      if (goal.status === 'running' || goal.status === 'waiting' || goal.status === 'paused')
        return this.save(goal, { pendingCaseAnswer });
      return this.save(goal, { pendingCaseAnswer, status: 'active', nextRunAt: this.stamp() });
    });
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

  pause(id: string): Promise<IGoal> {
    return this.exclusive(() => this.pauseUnlocked(id));
  }

  private async pauseUnlocked(id: string): Promise<IGoal> {
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
  reschedule(id: string, everyMinutes: number): Promise<IGoal> {
    return this.exclusive(() => this.rescheduleUnlocked(id, everyMinutes));
  }

  private async rescheduleUnlocked(id: string, everyMinutes: number): Promise<IGoal> {
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
  resume(id: string): Promise<IGoal> {
    return this.exclusive(() => this.resumeUnlocked(id));
  }

  private async resumeUnlocked(id: string): Promise<IGoal> {
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
  runAgain(id: string): Promise<IGoal> {
    return this.exclusive(() => this.runAgainUnlocked(id));
  }

  private async runAgainUnlocked(id: string): Promise<IGoal> {
    const goal = await this.require(id);
    if (goal.status === 'running' || goal.status === 'waiting')
      throw new GoalRefusedError('The goal is running; run it again after this run');
    if (goal.status === 'paused')
      throw new GoalRefusedError('The goal is paused; resume it to run it again');
    return this.save(goal, { status: 'active', nextRunAt: this.stamp() });
  }

  remove(id: string): Promise<void> {
    return this.exclusive(() => this.removeUnlocked(id));
  }

  private async removeUnlocked(id: string): Promise<void> {
    const goal = await this.require(id);
    if (goal.status === 'running' || goal.status === 'waiting')
      throw new GoalRefusedError('The goal is running; stop it after this run');
    await this.store.deleteGoal(id);
  }

  startRun(
    goalId: string,
    options: { readonly requireDue?: boolean; readonly ownerId?: string } = {},
  ): Promise<IGoalRun> {
    return this.exclusive(() => this.startRunUnlocked(goalId, options));
  }

  private async startRunUnlocked(
    goalId: string,
    options: { readonly requireDue?: boolean; readonly ownerId?: string },
  ): Promise<IGoalRun> {
    const goal = await this.require(goalId);
    if (
      options.requireDue === true &&
      (goal.status !== 'active' || goal.nextRunAt === undefined || goal.nextRunAt > this.stamp())
    )
      throw new GoalRefusedError('The goal is no longer due');
    if (
      goal.pendingCaseAnswer !== undefined &&
      goal.pendingCaseAnswer.ownerId !== (options.ownerId ?? 'local')
    )
      throw new GoalRefusedError('This case answer is owned by another agent');
    const at = this.stamp();
    const run: IGoalRun = {
      id: this.mint('run-'),
      goalId,
      startedAt: at,
      actions: [],
      ...(goal.pendingCaseAnswer !== undefined && {
        caseAnswerId: goal.pendingCaseAnswer.feedItemId,
      }),
    };
    await this.store.putRun(run);
    await this.save(
      goal,
      {
        status: 'running',
        lastRunAt: at,
        ...(goal.pendingCaseAnswer !== undefined && {
          lastCaseAnswerId: goal.pendingCaseAnswer.feedItemId,
        }),
      },
      ['nextRunAt', 'pendingCaseAnswer'],
    );
    return run;
  }

  recordAction(run: IGoalRun, action: Omit<IGoalAction, 'at'>): Promise<IGoalRun> {
    return this.exclusive(() => this.recordActionUnlocked(run, action));
  }

  private async recordActionUnlocked(
    run: IGoalRun,
    action: Omit<IGoalAction, 'at'>,
  ): Promise<IGoalRun> {
    const next: IGoalRun = { ...run, actions: [...run.actions, { ...action, at: this.stamp() }] };
    await this.store.putRun(next);
    return next;
  }

  setWaiting(goalId: string, waiting: boolean): Promise<void> {
    return this.exclusive(() => this.setWaitingUnlocked(goalId, waiting));
  }

  private async setWaitingUnlocked(goalId: string, waiting: boolean): Promise<void> {
    const goal = await this.require(goalId);
    await this.save(goal, { status: waiting ? 'waiting' : 'running' });
  }

  /** End a run, schedule the next one or close the goal, and report to the feed. */
  /**
   * End a run. A `quiet` run that went well is kept in the goal's history but is not posted to the
   * feed, so a goal that mostly finds nothing does not fill it; a run that did not go well is posted.
   */
  finishRun(
    run: IGoalRun,
    outcome: TGoalRunOutcome,
    report: string,
    options: { readonly quiet?: boolean } = {},
  ): Promise<IGoalRun> {
    return this.exclusive(() => this.finishRunUnlocked(run, outcome, report, options));
  }

  private async finishRunUnlocked(
    run: IGoalRun,
    outcome: TGoalRunOutcome,
    report: string,
    options: { readonly quiet?: boolean } = {},
  ): Promise<IGoalRun> {
    const goal = await this.require(run.goalId);
    const at = this.stamp();
    const finished: IGoalRun = { ...run, endedAt: at, outcome, report };
    await this.store.putRun(finished);
    if (goal.pendingCaseAnswer !== undefined) {
      await this.save(goal, { status: 'active', nextRunAt: at });
    } else if (goal.everyMinutes !== undefined) {
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
  recover(): Promise<number> {
    return this.exclusive(() => this.recoverUnlocked());
  }

  private async recoverUnlocked(): Promise<number> {
    let recovered = 0;
    for (const goal of await this.store.listGoals()) {
      let changed = false;
      for (const run of await this.store.listRuns(goal.id, Number.POSITIVE_INFINITY)) {
        if (run.endedAt === undefined) {
          await this.store.putRun({ ...run, endedAt: this.stamp(), outcome: 'interrupted' });
          changed = true;
        }
      }
      if (goal.status === 'running' || goal.status === 'waiting') {
        await this.save(goal, { status: 'active', nextRunAt: this.stamp() });
        changed = true;
      }
      if (changed) recovered += 1;
    }
    for (const item of await this.store.listFeed(Number.POSITIVE_INFINITY)) {
      if (item.approval?.state === 'pending') await this.setApproval(item.id, 'expired');
    }
    return recovered;
  }

  /** Recover one goal only when its host has proved no live agent owns it. */
  recoverGoal(id: string, options: { readonly adoptOwner?: string } = {}): Promise<boolean> {
    return this.exclusive(() => this.recoverGoalUnlocked(id, options));
  }

  private async recoverGoalUnlocked(
    id: string,
    options: { readonly adoptOwner?: string },
  ): Promise<boolean> {
    const goal = await this.store.getGoal(id);
    if (goal === undefined) return false;
    let changed = false;
    for (const item of await this.store.listFeed(Number.POSITIVE_INFINITY)) {
      if (item.goalId === id && item.approval?.state === 'pending') {
        await this.setApproval(item.id, 'expired');
        changed = true;
      }
    }
    for (const run of await this.store.listRuns(id, Number.POSITIVE_INFINITY)) {
      if (run.endedAt === undefined) {
        await this.store.putRun({ ...run, endedAt: this.stamp(), outcome: 'interrupted' });
        changed = true;
      }
    }
    const adopt =
      options.adoptOwner !== undefined &&
      goal.pendingCaseAnswer !== undefined &&
      goal.pendingCaseAnswer.ownerId !== options.adoptOwner;
    if (goal.status === 'running' || goal.status === 'waiting' || adopt) {
      await this.save(goal, {
        ...(goal.status === 'running' || goal.status === 'waiting'
          ? { status: 'active' as const, nextRunAt: this.stamp() }
          : {}),
        ...(adopt && {
          pendingCaseAnswer: { ...goal.pendingCaseAnswer!, ownerId: options.adoptOwner! },
        }),
      });
      changed = true;
    }
    return changed;
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

  /** Expire this exact approval after its prompt was cancelled before the action could start. */
  async cancelApproval(
    id: string,
    expected: {
      readonly goalId: string | undefined;
      readonly runId: string | undefined;
      readonly tool: string;
      readonly detail: string;
    },
  ): Promise<void> {
    const item = await this.store.getFeedItem(id);
    if (
      item === undefined ||
      item.goalId !== expected.goalId ||
      item.runId !== expected.runId ||
      item.approval?.tool !== expected.tool ||
      item.approval.detail !== expected.detail ||
      (item.approval.state !== 'pending' && item.approval.state !== 'approved')
    )
      return;
    await this.store.putFeedItem(
      { ...item, approval: { ...item.approval, state: 'expired' } },
      {
        cancelApproved: true,
      },
    );
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
