/**
 * Where a launch stands, for the person's page: starting while its request is only reserved, the live
 * states of its goal while that goal has more to do, and otherwise what the host decided when the goal
 * ended. The words are the host's own; the run's report is shown beside them as the model's account,
 * bounded and as plain text, and the evidence is what the host recorded, not what the report says.
 */
import type { IGoal } from '@robota-sdk/agent-product/personal';
import type { ILaunchIntent, ILaunchStatusView, ILaunchView, TLaunchProgress } from './types.js';

type TLiveGoalStatus = 'active' | 'running' | 'waiting' | 'paused';

const GOAL_STATE: Readonly<Record<TLiveGoalStatus, readonly [TLaunchProgress, string]>> = {
  active: ['starting', 'Your agent is getting this task going.'],
  running: ['running', 'Your agent is working on it now.'],
  waiting: ['waiting', 'Your agent is waiting for you. Open the goal or the Feed to answer it.'],
  paused: ['waiting', 'This goal is paused. Resume it from Goals to carry on.'],
};

/** The launch as the person's page reads it, without the host's own bookkeeping. */
export const launchView = ({
  idempotencyKey: _key,
  requestDigest: _digest,
  receipts: _receipts,
  outcome: _outcome,
  ...rest
}: ILaunchIntent): ILaunchView => rest;

/**
 * The status of an intent as it stands. `goal` is the goal it made, when it made one and it still
 * exists. A goal that is over without an outcome kept is not described here as ended: deciding it is
 * the coordinator's work, done before this is asked.
 */
export function describeStatus(input: {
  readonly intent: ILaunchIntent;
  readonly goal?: IGoal;
}): ILaunchStatusView {
  const { intent, goal } = input;
  const view = launchView(intent);
  const live = (progress: TLaunchProgress, reason: string): ILaunchStatusView => ({
    ...view,
    progress,
    reason,
    evidence: [],
  });
  switch (intent.status) {
    case 'reserved':
      return live('starting', 'Your agent is getting this task going.');
    case 'failed':
      return live('failed', intent.failure?.message ?? 'This request did not start.');
    case 'cancelled':
      return live('cancelled', 'This request was cancelled before it started.');
    case 'launched': {
      const { outcome } = intent;
      if (outcome !== undefined)
        return {
          ...view,
          progress: outcome.state,
          reason: outcome.reason,
          ...(outcome.report !== undefined && { report: outcome.report }),
          evidence: outcome.evidence,
          decidedAt: outcome.decidedAt,
        };
      const state =
        goal !== undefined && goal.status in GOAL_STATE
          ? GOAL_STATE[goal.status as TLiveGoalStatus]
          : GOAL_STATE.running;
      return live(state[0], state[1]);
    }
  }
}
