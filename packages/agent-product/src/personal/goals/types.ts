/**
 * Goals a personal agent works on while the person is away, and the feed it reports to.
 *
 * A goal is an instruction with a schedule. Each time it is due, a host runs it as one turn of its
 * own session and records a run: what the agent did, what it only planned because a person had to
 * approve it, and what it reported. Anything that needs the person, whether an approval or a result,
 * goes to the feed, which outlives any open page.
 */

export type TGoalStatus = 'active' | 'running' | 'waiting' | 'paused' | 'done' | 'failed';

export interface IGoal {
  readonly id: string;
  readonly title: string;
  /** What the agent is asked to do on each run, in the person's words. */
  readonly instructions: string;
  /** Run again this many minutes after a run ends; absent runs the goal once. */
  readonly everyMinutes?: number;
  /** Change nothing while running: the agent may only look, and anything else is refused. */
  readonly readOnly: boolean;
  readonly status: TGoalStatus;
  /** When the goal is next due (ISO 8601); absent when it is not scheduled. */
  readonly nextRunAt?: string;
  readonly lastRunAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One thing the agent did or tried during a run: the audit trail. */
export interface IGoalAction {
  readonly at: string;
  readonly tool: string;
  /** A short description of the call, never a secret it carried. */
  readonly detail: string;
  readonly outcome: 'done' | 'error' | 'denied' | 'waiting-approval' | 'approved';
}

export type TGoalRunOutcome = 'done' | 'failed' | 'interrupted';

export interface IGoalRun {
  readonly id: string;
  readonly goalId: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly outcome?: TGoalRunOutcome;
  /** What the agent reported at the end of the run. */
  readonly report?: string;
  readonly actions: readonly IGoalAction[];
}

export type TFeedKind = 'report' | 'approval' | 'notice';
export type TApprovalState = 'pending' | 'approved' | 'denied' | 'expired';

export interface IFeedItem {
  readonly id: string;
  readonly at: string;
  readonly kind: TFeedKind;
  readonly title: string;
  readonly body: string;
  readonly goalId?: string;
  readonly runId?: string;
  /** Present on an approval: the action that waits for the person. */
  readonly approval?: {
    readonly tool: string;
    readonly detail: string;
    readonly state: TApprovalState;
  };
  readonly dismissed: boolean;
}

/** Where goals, their runs and the feed live; a host supplies one per principal. */
export interface IGoalStore {
  listGoals(): Promise<readonly IGoal[]>;
  getGoal(id: string): Promise<IGoal | undefined>;
  putGoal(goal: IGoal): Promise<void>;
  deleteGoal(id: string): Promise<void>;
  putRun(run: IGoalRun): Promise<void>;
  /** A goal's runs, newest first. */
  listRuns(goalId: string, limit: number): Promise<readonly IGoalRun[]>;
  putFeedItem(item: IFeedItem): Promise<void>;
  getFeedItem(id: string): Promise<IFeedItem | undefined>;
  /** Feed items, newest first. */
  listFeed(limit: number): Promise<readonly IFeedItem[]>;
}
