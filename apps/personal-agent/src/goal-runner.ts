/**
 * Runs the personal agent's goals while nobody is watching.
 *
 * Each due goal runs as one turn of its own session, opened with the agent's tools and limits; a
 * read-only goal runs in plan mode, so it can only look. Whatever the session would ask a person,
 * the runner turns into an approval in the feed, and the turn waits for it: the person answers from
 * the page whenever they come back, or the session's own backstop refuses it. Every tool call becomes
 * an entry in the run's audit trail, and the run's last words are its report.
 *
 * The runner keeps no state of its own beyond the sessions it has open: the goal book is the record,
 * so after a restart the book's recovery makes interrupted goals due again.
 */
import {
  CONNECTOR_TOOL_NAMES,
  GOAL_TOOL_NAMES,
  GoalRefusedError,
  goalRunInstructions,
  parseConnectorArguments,
} from '@robota-sdk/agent-product/personal';

import { EMPTY_REPORT } from './run-report.js';

import type { GoalBook, IFeedItem, IGoal, IGoalRun } from '@robota-sdk/agent-product/personal';
import type { IToolWithEventService } from '@robota-sdk/agent-core';
import type { IExtraSessionOptions, TPersonalSession } from './agent.js';
import type { IApprovalRegistry } from './approvals.js';

export type TRunSession = Pick<
  TPersonalSession,
  'on' | 'off' | 'submit' | 'resolvePermission' | 'shutdown' | 'abort'
>;

/** How one goal differs from an ordinary one: more to tell the run, and fewer tools it is given. */
export interface IGoalShape {
  readonly instructions: string;
  /** The only tools the run has. */
  readonly onlyTools: readonly string[];
  /**
   * Tools that stand in, for this run only, for the agent's own of the same name: the browser's reading
   * tools made to record what they return, say. Each must be one of the tools offered in `onlyTools`.
   */
  readonly scopedTools?: readonly IToolWithEventService[];
  /** A case-only replacement for the connector action; every call still requires approval. */
  readonly caseAction?: ICaseAction;
  /** Case mutations that are valid only for this answer and this case. */
  readonly caseTools?: readonly IToolWithEventService[];
}

export interface IApprovedConnectorCall {
  readonly connector: string;
  readonly tool: string;
  readonly argumentsJson: string;
}

export interface IExpectedCaseApproval {
  readonly id: string;
  readonly goalId: string;
  readonly runId: string;
  readonly detail: string;
}

export interface ICaseAction {
  readonly tool: IToolWithEventService;
  /** Bind the displayed call to its execution and the durable approval record. */
  approved(
    executionId: string,
    call: IApprovedConnectorCall,
    recorded: Promise<IFeedItem>,
    expected: IExpectedCaseApproval,
  ): void;
}

export interface IGoalRunnerOptions {
  readonly book: GoalBook;
  readonly openSession: (extra: IExtraSessionOptions) => TRunSession;
  /** Where the runs' approvals wait for the person, shared with every other source of approvals. */
  readonly approvals: IApprovalRegistry;
  /**
   * Called with each finished run's report, after the run is recorded. `quiet` says the run was kept in
   * the goal's history only: a host that tells the person on their channels leaves a quiet run out.
   */
  readonly onReport?: (goal: IGoal, report: string, run: { readonly quiet: boolean }) => void;
  /** How often to look for due goals; 0 runs only when asked. */
  readonly tickMs?: number;
  /** Recover abandoned work before looking for due goals. */
  readonly beforeRunDue?: (
    isRunning: (goalId: string) => boolean,
    recover: (goalId: string, work: () => Promise<unknown>) => Promise<void>,
  ) => Promise<void>;
  /** A goal that is more than the person's instruction, such as one keeping a connector in sync. */
  readonly shape?: (goal: IGoal, run: IGoalRun) => Promise<IGoalShape | undefined>;
  readonly ownerId?: string;
  /** Leave a goal due if its host cannot yet establish that its input is ready. */
  readonly mayStart?: (goal: IGoal) => boolean | Promise<boolean>;
  /** A run that went well and is not worth the person's attention: kept in the goal's history only. */
  readonly quiet?: (goal: IGoal) => Promise<boolean>;
}

export interface IGoalRunner {
  /** Start every due goal that is not already running; returns how many started. */
  runDue(): Promise<number>;
  isRunning(goalId: string): boolean;
  /** Answer an approval waiting in the feed. */
  answer(feedId: string, approve: boolean): Promise<IFeedItem>;
  /** Resolves when every run started so far has ended, or when the given goal's run has. */
  settled(goalId?: string): Promise<void>;
  /** End the turns of the runs in progress (of one goal when given), as a person's Stop does; later runs still start. */
  interrupt(goalId?: string): void;
  stop(): Promise<void>;
}

const DETAIL_LIMIT = 300;

/** What an approval shows the person: the call, briefly, with its address first when it has one. */
export function describeCall(
  toolName: string,
  args: Readonly<Record<string, unknown>>,
): string | undefined {
  if (toolName === CONNECTOR_TOOL_NAMES.act) {
    try {
      const raw = args['argumentsJson'];
      if (raw !== undefined && typeof raw !== 'string') return undefined;
      const effective = parseConnectorArguments(raw);
      const json = JSON.stringify({ ...args, argumentsJson: effective }).replace(
        /\p{Cf}/gu,
        (char) => `\\u{${char.codePointAt(0)!.toString(16)}}`,
      );
      const detail = `${toolName} ${json}`;
      return detail.length <= DETAIL_LIMIT ? detail : undefined;
    } catch {
      return undefined;
    }
  }
  const method = typeof args['method'] === 'string' ? `${args['method']} ` : '';
  if (typeof args['url'] === 'string') return `${method}${args['url']}`.slice(0, DETAIL_LIMIT);
  const json = JSON.stringify(args);
  return `${toolName} ${json.length > DETAIL_LIMIT ? `${json.slice(0, DETAIL_LIMIT)}…` : json}`;
}

function approvedConnectorCall(
  args: Readonly<Record<string, unknown>>,
): IApprovedConnectorCall | undefined {
  const connector = args['connector'];
  const tool = args['tool'];
  const raw = args['argumentsJson'];
  if (
    typeof connector !== 'string' ||
    typeof tool !== 'string' ||
    (raw !== undefined && typeof raw !== 'string')
  )
    return undefined;
  try {
    return { connector, tool, argumentsJson: JSON.stringify(parseConnectorArguments(raw)) };
  } catch {
    return undefined;
  }
}

export function createGoalRunner(options: IGoalRunnerOptions): IGoalRunner {
  const { book } = options;
  const running = new Map<string, Promise<void>>();
  const controls = new Map<string, { cancelled: boolean }>();
  const scheduling = new Set<{
    cancelledAll: boolean;
    readonly cancelled: Set<string>;
    done: Promise<number>;
  }>();
  const recovering = new Map<string, Set<Promise<unknown>>>();
  /** A goal is owned from before its persisted claim until its session is registered. */
  const claiming = new Map<
    string,
    {
      readonly started: Promise<IGoalRun>;
      readonly completed: Promise<void>;
      readonly finish: () => void;
      cancelled: boolean;
    }
  >();
  const owns = (goalId: string): boolean => running.has(goalId) || claiming.has(goalId);
  /** The runs' sessions, with the goal each belongs to. */
  const sessions = new Map<TRunSession, string>();
  const { approvals } = options;
  let stopped = false;
  const finishInterrupted = (run: IGoalRun): Promise<IGoalRun> =>
    book.finishRun(
      run,
      'interrupted',
      'The run was stopped.',
      stopped ? { resumeCaseOwner: options.ownerId ?? 'local' } : {},
    );

  /** A goal waits while any of its approvals does, and works again once none is left. */
  const settleWaiting = async (goalId: string): Promise<void> => {
    await book.setWaiting(goalId, approvals.waitingFor(goalId));
  };

  const runGoal = async (
    goal: IGoal,
    initialRun: IGoalRun,
    control: { cancelled: boolean },
  ): Promise<void> => {
    let run: IGoalRun = initialRun;
    // Writes to the run and the feed happen in order, whatever order the session's events arrive in.
    let chain = Promise.resolve();
    const enqueue = (work: () => Promise<void>): Promise<void> => {
      // allow-fallback: one failed write must not keep the run from finishing and reporting.
      chain = chain.then(work).catch(() => undefined);
      return chain;
    };
    const record = (action: Parameters<GoalBook['recordAction']>[1]): Promise<void> =>
      enqueue(async () => {
        run = await book.recordAction(run, action);
      });
    let shape: IGoalShape | undefined;
    try {
      shape = await options.shape?.(goal, run);
    } catch (error) {
      if (!stopped && !control.cancelled) throw error;
      await finishInterrupted(run);
      return;
    }
    if (stopped || control.cancelled) {
      await finishInterrupted(run);
      return;
    }
    if (
      shape?.caseAction !== undefined &&
      (goal.caseId === undefined || !shape.onlyTools.includes(CONNECTOR_TOOL_NAMES.act))
    )
      throw new Error('A case action requires a case goal and its scoped tool');
    const session = options.openSession({
      sessionName: `Goal: ${goal.title}`,
      instructions: [
        goalRunInstructions(shape?.caseAction === undefined ? goal : { ...goal, readOnly: false }),
        shape?.instructions,
      ]
        .filter((text) => text !== undefined)
        .join('\n\n'),
      permissionMode: shape?.caseAction === undefined && goal.readOnly ? 'plan' : 'acceptEdits',
      deniedTools: Object.values(GOAL_TOOL_NAMES),
      ...(shape !== undefined && { onlyTools: shape.onlyTools }),
      ...(shape?.caseAction !== undefined && { caseAction: shape.caseAction.tool }),
      ...(shape?.caseTools !== undefined && { caseTools: shape.caseTools }),
      ...(shape?.scopedTools !== undefined && { scopedTools: shape.scopedTools }),
    });
    sessions.set(session, goal.id);
    if (stopped || control.cancelled) {
      session.abort();
      try {
        await finishInterrupted(run);
      } finally {
        sessions.delete(session);
        await session.shutdown().catch(() => undefined);
      }
      return;
    }
    /** Prompt id to the feed item that shows it. */
    const ownPrompts = new Map<string, string>();
    const settledEarly = new Set<string>();
    let approvalFailed = false;
    const onToolEnd = (state: { toolName: string; firstArg: string; result?: string }): void => {
      const outcome =
        state.result === 'success' ? 'done' : state.result === 'denied' ? 'denied' : 'error';
      void record({ tool: state.toolName, detail: state.firstArg.slice(0, DETAIL_LIMIT), outcome });
    };
    const onPermission = (event: {
      id: string;
      toolName: string;
      toolArgs: Record<string, unknown>;
      executionId?: string;
    }): void => {
      const detail = describeCall(event.toolName, event.toolArgs);
      const executionId = event.executionId;
      const caseCall =
        shape?.caseAction !== undefined && event.toolName === CONNECTOR_TOOL_NAMES.act
          ? approvedConnectorCall(event.toolArgs)
          : undefined;
      if (
        detail === undefined ||
        (shape?.caseAction !== undefined &&
          event.toolName === CONNECTOR_TOOL_NAMES.act &&
          (caseCall === undefined || executionId === undefined))
      ) {
        session.resolvePermission(event.id, false);
        settledEarly.delete(event.id);
        void record({
          tool: event.toolName,
          detail: 'Action details cannot be shown safely',
          outcome: 'denied',
        });
        void enqueue(async () => {
          await book.post({
            kind: 'notice',
            title: goal.title,
            body: 'The connector action was refused because its complete details are too long or cannot be shown safely.',
            goalId: goal.id,
            runId: run.id,
          });
        });
        return;
      }
      const donePreparing = approvals.preparing();
      void enqueue(async () => {
        let item: IFeedItem | undefined;
        let registered = false;
        try {
          run = await book.recordAction(run, {
            tool: event.toolName,
            detail,
            outcome: 'waiting-approval',
          });
          item = await book.post({
            kind: 'approval',
            title: goal.title,
            body: `Your agent wants to use ${event.toolName} while working on this goal.`,
            goalId: goal.id,
            runId: run.id,
            approval: { tool: event.toolName, detail, state: 'pending' },
          });
          const posted = item;
          ownPrompts.set(event.id, posted.id);
          if (settledEarly.delete(event.id)) {
            await book.setApproval(posted.id, 'expired');
            return;
          }
          approvals.register(item, {
            session,
            promptId: event.id,
            goalId: goal.id,
            recordAnswer: (approve) => {
              let answered: IFeedItem | undefined;
              const done = enqueue(async () => {
                answered = await book.setApproval(posted.id, approve ? 'approved' : 'denied');
                run = await book.recordAction(run, {
                  tool: event.toolName,
                  detail,
                  outcome: approve ? 'approved' : 'denied',
                });
                await settleWaiting(goal.id);
              });
              const recorded = done.then(() => {
                if (answered === undefined) throw new Error('The answer could not be recorded');
                return answered;
              });
              if (approve && caseCall !== undefined && executionId !== undefined)
                shape?.caseAction?.approved(executionId, caseCall, recorded, {
                  id: posted.id,
                  goalId: goal.id,
                  runId: run.id,
                  detail,
                });
              return recorded;
            },
          });
          registered = true;
          await book.setWaiting(goal.id, true);
        } catch {
          if (item === undefined || !registered || approvals.release(item.id) || stopped) {
            approvalFailed = true;
            session.resolvePermission(event.id, false);
            settledEarly.delete(event.id);
            if (item !== undefined)
              await book.setApproval(item.id, 'expired').catch(() => undefined);
          }
        } finally {
          donePreparing();
        }
      });
    };
    // A prompt settled by anything but the person's answer (the session's backstop, a shutdown) was
    // refused: its approval can no longer be given, so it is expired, never approved.
    const onResolved = (event: { id: string }): void => {
      const feedId = ownPrompts.get(event.id);
      if (feedId === undefined) {
        settledEarly.add(event.id);
        return;
      }
      if (!approvals.release(feedId)) return;
      void enqueue(async () => {
        await book.setApproval(feedId, 'expired');
        const item = await book.feedItem(feedId);
        run = await book.recordAction(run, {
          tool: item?.approval?.tool ?? 'unknown',
          detail: item?.approval?.detail ?? '',
          outcome: 'denied',
        });
        await settleWaiting(goal.id);
      });
    };
    session.on('tool_end', onToolEnd as never);
    session.on('permission_request', onPermission as never);
    session.on('prompt_resolved', onResolved as never);
    let outcome: 'done' | 'failed' | 'interrupted' = 'done';
    let report: string;
    let settledBeforeShutdown = false;
    try {
      // A run that was starting while the runner stopped ends here instead of working unwatched.
      if (stopped) throw new Error('the agent was stopping');
      const handle = await session.submit(goal.instructions);
      const result = await handle.completed;
      settledBeforeShutdown = !stopped;
      report = result.response.trim() === '' ? EMPTY_REPORT : result.response.trim();
    } catch (error) {
      settledBeforeShutdown = !stopped;
      outcome = 'failed';
      report = `The run failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      session.off('tool_end', onToolEnd as never);
      session.off('permission_request', onPermission as never);
      session.off('prompt_resolved', onResolved as never);
    }
    await chain;
    if (
      stopped &&
      !settledBeforeShutdown &&
      goal.caseId !== undefined &&
      run.caseAnswerId !== undefined
    ) {
      outcome = 'interrupted';
      report = 'The run was stopped.';
    } else if (approvalFailed) {
      outcome = 'failed';
      report = 'The action was refused because its approval could not be shown or recorded.';
    }
    // An approval the turn stopped waiting for can no longer be answered.
    for (const feedId of ownPrompts.values()) {
      if (approvals.release(feedId)) await book.setApproval(feedId, 'expired');
    }
    // Judged once, before the report is announced: a host's bookkeeping about the run may depend on it.
    const quiet = outcome === 'done' && (await options.quiet?.(goal)) === true;
    await book.finishRun(run, outcome, report, {
      quiet,
      ...(outcome === 'interrupted' ? { resumeCaseOwner: options.ownerId ?? 'local' } : {}),
    });
    try {
      options.onReport?.(goal, report, { quiet });
    } catch {
      // allow-fallback: telling the person elsewhere must never undo a finished run.
    }
    sessions.delete(session);
    await session.shutdown().catch(() => undefined);
  };

  const runDueWork = async (activity: {
    cancelledAll: boolean;
    readonly cancelled: Set<string>;
  }): Promise<number> => {
    if (stopped || activity.cancelledAll) return 0;
    await approvals.settleFailed();
    await options.beforeRunDue?.(owns, async (goalId, work) => {
      if (stopped || activity.cancelledAll || activity.cancelled.has(goalId)) return;
      const task = work();
      const tasks = recovering.get(goalId) ?? new Set<Promise<unknown>>();
      tasks.add(task);
      recovering.set(goalId, tasks);
      try {
        await task;
      } finally {
        tasks.delete(task);
        if (tasks.size === 0) recovering.delete(goalId);
      }
    });
    if (stopped) return 0;
    let started = 0;
    for (const goal of await book.due()) {
      if (stopped || activity.cancelledAll) break;
      if (activity.cancelled.has(goal.id)) continue;
      if (owns(goal.id)) continue;
      if (options.mayStart !== undefined && !(await options.mayStart(goal))) continue;
      let finish!: () => void;
      const completed = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const claim = {
        started: book.startRun(goal.id, { requireDue: true, ownerId: options.ownerId ?? 'local' }),
        completed,
        finish,
        cancelled: false,
      };
      claiming.set(goal.id, claim);
      let run: IGoalRun;
      try {
        run = await claim.started;
      } catch (error) {
        claiming.delete(goal.id);
        claim.finish();
        if (error instanceof GoalRefusedError) continue;
        throw error;
      }
      if (claim.cancelled || stopped) {
        try {
          await finishInterrupted(run);
        } finally {
          claiming.delete(goal.id);
          claim.finish();
        }
        continue;
      }
      started += 1;
      const control = { cancelled: false };
      controls.set(goal.id, control);
      const task = runGoal(goal, run, control)
        .catch(async (error: unknown) => {
          await book.post({
            kind: 'notice',
            title: goal.title,
            body: `The goal could not run: ${error instanceof Error ? error.message : String(error)}`,
            goalId: goal.id,
          });
        })
        // allow-fallback: a run that cannot even report must not end the process serving the person.
        .catch(() => undefined)
        .finally(() => {
          running.delete(goal.id);
          controls.delete(goal.id);
        });
      running.set(goal.id, task);
      claiming.delete(goal.id);
      claim.finish();
    }
    return started;
  };

  const runDue = (): Promise<number> => {
    const activity = {
      cancelledAll: false,
      cancelled: new Set<string>(),
      done: Promise.resolve(0),
    };
    scheduling.add(activity);
    const task = runDueWork(activity);
    activity.done = task;
    void task.then(
      () => scheduling.delete(activity),
      () => scheduling.delete(activity),
    );
    return task;
  };

  const timer =
    options.tickMs !== undefined && options.tickMs > 0
      ? setInterval(() => {
          void runDue().catch(() => undefined);
        }, options.tickMs)
      : undefined;
  timer?.unref();

  return {
    runDue,
    isRunning: owns,
    answer: (feedId, approve) => approvals.answer(feedId, approve),
    async settled(goalId) {
      if (goalId !== undefined) {
        while (recovering.has(goalId))
          await Promise.allSettled([...(recovering.get(goalId) ?? [])]);
        while (claiming.has(goalId)) await claiming.get(goalId)!.completed;
        await running.get(goalId);
        return;
      }
      while (scheduling.size > 0 || claiming.size > 0 || running.size > 0)
        await Promise.allSettled([
          ...[...scheduling].map((activity) => activity.done),
          ...[...claiming.values()].map((claim) => claim.completed),
          ...running.values(),
        ]);
    },
    interrupt(goalId) {
      for (const activity of scheduling) {
        if (goalId === undefined) activity.cancelledAll = true;
        else activity.cancelled.add(goalId);
      }
      for (const [id, claim] of claiming) {
        if (goalId === undefined || id === goalId) claim.cancelled = true;
      }
      for (const [id, control] of controls) {
        if (goalId === undefined || id === goalId) control.cancelled = true;
      }
      for (const [session, owner] of sessions) {
        if (goalId === undefined || owner === goalId) session.abort();
      }
    },
    async stop() {
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
      for (const control of controls.values()) control.cancelled = true;
      // Abort every running turn: its prompts are refused, so nothing waits on a person who is gone.
      const cancelling = [...sessions.keys()].map((session) => approvals.cancelSession(session));
      for (const session of sessions.keys()) session.abort();
      await Promise.allSettled(cancelling);
      while (scheduling.size > 0)
        await Promise.allSettled([...scheduling].map((activity) => activity.done));
      while (claiming.size > 0)
        await Promise.allSettled([...claiming.values()].map((claim) => claim.completed));
      for (const session of sessions.keys()) session.abort();
      await Promise.allSettled([...running.values()]);
      await approvals.settleFailed();
    },
  };
}
