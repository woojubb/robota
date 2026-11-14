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
import { GOAL_TOOL_NAMES, goalRunInstructions } from '@robota-sdk/agent-product/personal';

import type { GoalBook, IFeedItem, IGoal, IGoalRun } from '@robota-sdk/agent-product/personal';
import type { IExtraSessionOptions, TPersonalSession } from './agent.js';

type TRunSession = Pick<TPersonalSession, 'on' | 'off' | 'submit' | 'resolvePermission' | 'shutdown'>;

export interface IGoalRunnerOptions {
  readonly book: GoalBook;
  readonly openSession: (extra: IExtraSessionOptions) => TRunSession;
  /** How often to look for due goals; 0 runs only when asked. */
  readonly tickMs?: number;
}

export interface IGoalRunner {
  /** Start every due goal that is not already running; returns how many started. */
  runDue(): Promise<number>;
  /** Answer an approval waiting in the feed. */
  answer(feedId: string, approve: boolean): Promise<IFeedItem>;
  /** Resolves when every run started so far has ended. */
  settled(): Promise<void>;
  stop(): Promise<void>;
}

const DETAIL_LIMIT = 300;

/** What an approval shows the person: the call, briefly, with its address first when it has one. */
export function describeCall(toolName: string, args: Readonly<Record<string, unknown>>): string {
  const method = typeof args['method'] === 'string' ? `${args['method']} ` : '';
  if (typeof args['url'] === 'string') return `${method}${args['url']}`.slice(0, DETAIL_LIMIT);
  const json = JSON.stringify(args);
  return `${toolName} ${json.length > DETAIL_LIMIT ? `${json.slice(0, DETAIL_LIMIT)}…` : json}`;
}

interface IPendingApproval {
  readonly session: TRunSession;
  readonly promptId: string;
  readonly goalId: string;
  readonly record: (outcome: 'approved' | 'denied') => Promise<void>;
}

export function createGoalRunner(options: IGoalRunnerOptions): IGoalRunner {
  const { book } = options;
  const running = new Map<string, Promise<void>>();
  const pending = new Map<string, IPendingApproval>();
  let stopped = false;

  const runGoal = async (goal: IGoal): Promise<void> => {
    let run: IGoalRun = await book.startRun(goal.id);
    // Writes to the run happen in order, whatever order the session's events arrive in.
    let chain = Promise.resolve();
    const record = (action: Parameters<GoalBook['recordAction']>[1]): Promise<void> => {
      chain = chain.then(async () => {
        run = await book.recordAction(run, action);
      });
      return chain;
    };
    const session = options.openSession({
      sessionName: `Goal: ${goal.title}`,
      instructions: goalRunInstructions(goal),
      permissionMode: goal.readOnly ? 'plan' : 'acceptEdits',
      deniedTools: Object.values(GOAL_TOOL_NAMES),
    });
    const ownPrompts = new Map<string, string>();
    const onToolEnd = (state: { toolName: string; firstArg: string; result?: string }): void => {
      const outcome = state.result === 'success' ? 'done' : state.result === 'denied' ? 'denied' : 'error';
      void record({ tool: state.toolName, detail: state.firstArg.slice(0, DETAIL_LIMIT), outcome });
    };
    const onPermission = (event: { id: string; toolName: string; toolArgs: Record<string, unknown> }): void => {
      const detail = describeCall(event.toolName, event.toolArgs);
      void (async () => {
        await record({ tool: event.toolName, detail, outcome: 'waiting-approval' });
        const item = await book.post({
          kind: 'approval',
          title: goal.title,
          body: `Your agent wants to use ${event.toolName} while working on this goal.`,
          goalId: goal.id,
          runId: run.id,
          approval: { tool: event.toolName, detail, state: 'pending' },
        });
        ownPrompts.set(event.id, item.id);
        pending.set(item.id, {
          session,
          promptId: event.id,
          goalId: goal.id,
          record: (outcome) => record({ tool: event.toolName, detail, outcome }),
        });
        await book.setWaiting(goal.id, true);
      })();
    };
    session.on('tool_end', onToolEnd as never);
    session.on('permission_request', onPermission as never);
    let outcome: 'done' | 'failed' = 'done';
    let report: string;
    try {
      const handle = await session.submit(goal.instructions);
      const result = await handle.completed;
      report = result.response.trim() === '' ? 'The run ended without a report.' : result.response.trim();
    } catch (error) {
      outcome = 'failed';
      report = `The run failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      session.off('tool_end', onToolEnd as never);
      session.off('permission_request', onPermission as never);
    }
    await chain;
    // An approval the turn stopped waiting for (its backstop, or the turn ending) can no longer be answered.
    for (const feedId of ownPrompts.values()) {
      if (pending.delete(feedId)) await book.setApproval(feedId, 'expired');
    }
    await book.finishRun(run, outcome, report);
    await session.shutdown().catch(() => undefined);
  };

  const runDue = async (): Promise<number> => {
    if (stopped) return 0;
    let started = 0;
    for (const goal of await book.due()) {
      if (running.has(goal.id)) continue;
      started += 1;
      const task = runGoal(goal)
        .catch(async (error: unknown) => {
          await book.post({
            kind: 'notice',
            title: goal.title,
            body: `The goal could not run: ${error instanceof Error ? error.message : String(error)}`,
            goalId: goal.id,
          });
        })
        .finally(() => running.delete(goal.id));
      running.set(goal.id, task);
    }
    return started;
  };

  const timer =
    options.tickMs !== undefined && options.tickMs > 0
      ? setInterval(() => {
          void runDue();
        }, options.tickMs)
      : undefined;
  timer?.unref();

  return {
    runDue,
    async answer(feedId, approve) {
      const waiting = pending.get(feedId);
      if (waiting === undefined) {
        const item = await book.feedItem(feedId);
        if (item?.approval?.state === 'pending') return book.setApproval(feedId, 'expired');
        throw new Error('This approval is no longer waiting');
      }
      pending.delete(feedId);
      const item = await book.setApproval(feedId, approve ? 'approved' : 'denied');
      await waiting.record(approve ? 'approved' : 'denied');
      await book.setWaiting(waiting.goalId, false);
      waiting.session.resolvePermission(waiting.promptId, approve);
      return item;
    },
    async settled() {
      while (running.size > 0) await Promise.allSettled([...running.values()]);
    },
    async stop() {
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
      for (const waiting of pending.values()) waiting.session.resolvePermission(waiting.promptId, false);
      await Promise.allSettled([...running.values()]);
    },
  };
}
