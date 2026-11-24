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
  /** The connector this goal keeps in sync, when it is one: a person's own goals have none. */
  readonly connectorId?: string;
  /** The case this goal gives a turn on, when it is one: found by this id, and run again for each answer. */
  readonly caseId?: string;
  /**
   * The launch this goal was made for, when it was made by a host that records the person's requests:
   * a typed mark, never text in the instructions. One launch id has one goal, so a host that stopped
   * between making the goal and recording it finds this one again.
   */
  readonly launch?: { readonly id: string };
  /** An accepted case answer awaiting a turn, owned by the agent holding its authority snapshot. */
  readonly pendingCaseAnswer?: { readonly feedItemId: string; readonly ownerId: string };
  /** The agent and answer associated with a claimed case turn. */
  readonly activeCaseRun?: {
    readonly runId: string;
    readonly ownerId: string;
    readonly answerId: string;
  };
  /** The most recent case answer whose turn has started. */
  readonly lastCaseAnswerId?: string;
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
  readonly caseAnswerId?: string;
  readonly caseOwnerId?: string;
  readonly resumeAfterShutdown?: true;
  readonly caseReport?: 'pending' | 'recorded' | 'quiet';
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly outcome?: TGoalRunOutcome;
  /** What the agent reported at the end of the run. */
  readonly report?: string;
  readonly actions: readonly IGoalAction[];
}

export type TFeedKind = 'report' | 'approval' | 'notice' | 'question';
export type TApprovalState = 'pending' | 'approved' | 'denied' | 'expired';
/** A question is open until the person answers it, or withdrawn when its case closes first. */
export type TQuestionState = 'open' | 'answered' | 'withdrawn';

/** What the person answered: one of the offered choices, or a reply in their own words. */
export interface IQuestionAnswer {
  readonly choice?: string;
  readonly reply?: string;
  readonly at: string;
}

/** The question the agent asks from a case, and where it stands. Never approved, only answered. */
export interface IFeedQuestion {
  readonly caseId: string;
  readonly text: string;
  readonly options: readonly string[];
  readonly allowsReply: boolean;
  readonly state: TQuestionState;
  readonly answer?: IQuestionAnswer;
  /**
   * How the case closed, when it closed right after this answer: shown under the answer so a close the
   * person would want to know about is not left in the case's thread alone. Written by the agent from
   * content other people wrote, so a host shows it as plain text.
   */
  readonly resolution?: string;
}

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
  /** Present on a question: what the agent asks the person about one of its cases. */
  readonly question?: IFeedQuestion;
  readonly dismissed: boolean;
}

/** Where goals, their runs and the feed live; a host supplies one per principal. */
export interface IGoalStore {
  /** The file store synchronizes feed replacements before exposing them to a host. */
  readonly durableFeedWrites?: true;
  listGoals(): Promise<readonly IGoal[]>;
  getGoal(id: string): Promise<IGoal | undefined>;
  putGoal(goal: IGoal): Promise<void>;
  deleteGoal(id: string): Promise<void>;
  putRun(run: IGoalRun): Promise<void>;
  /** A goal's runs, newest first. */
  listRuns(goalId: string, limit: number): Promise<readonly IGoalRun[]>;
  putFeedItem(item: IFeedItem, options?: { readonly cancelApproved?: boolean }): Promise<void>;
  getFeedItem(id: string): Promise<IFeedItem | undefined>;
  /** Feed items, newest first. */
  listFeed(limit: number): Promise<readonly IFeedItem[]>;
}
