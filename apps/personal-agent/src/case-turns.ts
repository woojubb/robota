/**
 * How the turn on a case is started, run and reported: when the person answers a case's question the
 * agent takes one more turn on that case, as a goal of its own, to decide what the answer means. The
 * goal machinery is the ordinary one; this is the part that knows about cases. The owner can also
 * authorize a specific connector for a turn, subject to a separate approval for each action.
 */
import {
  caseTurnInstructions,
  caseTurnPrompt,
  caseTurnTools,
  CONNECTOR_TOOL_NAMES,
  createCaseTools,
} from '@robota-sdk/agent-product/personal';

import type {
  CaseBook,
  GoalBook,
  ICase,
  IGoal,
  IGoalRun,
} from '@robota-sdk/agent-product/personal';
import type { IGoalShape } from './goal-runner.js';
import type { ICaseAction } from './goal-runner.js';
import type { ICaseActionSnapshot } from './case-action.js';

export interface ICaseTurns {
  /** Keep only the authority captured for the answer that was actually accepted. */
  remember(answered: ICase, snapshot: ICaseActionSnapshot | undefined): void;
  /** Make the case's goal due: one goal for each case, created by its first answer and run again by each later one. */
  onAnswered(answered: ICase, ownerId?: string): Promise<void>;
  shape(goal: IGoal, run?: IGoalRun): Promise<IGoalShape | undefined>;
  quiet(goal: IGoal): Promise<boolean>;
  /**
   * Called when a case turn has ended, whether it went well or not. When the person answered the case
   * while it ran, the answer's owner queues it for a later turn. This says whether such a turn is due
   * so the host can look again after the current run has ended.
   */
  ended(goal: IGoal): Promise<boolean>;
}

export function createCaseTurns(options: {
  readonly goals: GoalBook;
  readonly cases: CaseBook;
  readonly ownerId?: string;
  readonly makeAction?: (snapshot: ICaseActionSnapshot) => ICaseAction;
}): ICaseTurns {
  /** How many events a case had when its turn began, to tell what the turn left and what came during it. */
  const atStart = new Map<string, number>();
  const answers = new Map<string, ICaseActionSnapshot>();

  async function onAnswered(answered: ICase, ownerId?: string): Promise<void> {
    if (answered.lastAnsweredFeedItemId === undefined) return;
    await options.goals.enqueueCaseAnswer({
      caseId: answered.id,
      feedItemId: answered.lastAnsweredFeedItemId,
      ownerId: ownerId ?? options.ownerId ?? 'local',
      title: `Case: ${answered.title}`,
      instructions: caseTurnPrompt(),
    });
  }

  return {
    remember(answered, snapshot) {
      const feedId = answered.lastAnsweredFeedItemId;
      if (feedId === undefined) return;
      answers.delete(feedId);
      if (snapshot?.caseId === answered.id && snapshot.feedItemId === feedId) {
        answers.set(feedId, snapshot);
        if (answers.size > 1_000) answers.delete(answers.keys().next().value!);
      }
    },
    onAnswered,

    async shape(goal, run) {
      if (goal.caseId === undefined) return undefined;
      // Read when the turn begins, not when the answer came: the case may have moved on since.
      const found = await options.cases.get(goal.caseId);
      if (found !== undefined) atStart.set(goal.id, found.history.length);
      const answerId = run?.caseAnswerId ?? found?.lastAnsweredFeedItemId;
      const snapshot =
        answerId !== undefined && answerId === found?.lastAnsweredFeedItemId
          ? answers.get(answerId)
          : undefined;
      if (answerId !== undefined) answers.delete(answerId);
      if (found === undefined || found.state === 'closed') {
        return {
          instructions:
            'The case is gone or already settled. Say so in one line and do nothing else.',
          onlyTools: [],
        };
      }
      if (run?.caseAnswerId !== undefined && run.caseAnswerId !== found.lastAnsweredFeedItemId) {
        return {
          instructions: 'A newer answer is waiting for its own turn. Leave the case unchanged.',
          onlyTools: [],
        };
      }
      if (found.question !== undefined) {
        return {
          instructions:
            "The case is still waiting for the person's answer. Say so in one line and do nothing else.",
          onlyTools: [],
        };
      }
      if (answerId === undefined) {
        return {
          instructions: 'The answer cannot be identified. Leave the case unchanged.',
          onlyTools: [],
        };
      }
      const caseTools = createCaseTools(options.cases, { caseId: found.id, answerId });
      if (snapshot !== undefined && options.makeAction !== undefined) {
        return {
          instructions: caseTurnInstructions(found, { allowApprovedActions: true }),
          onlyTools: [...caseTurnTools(), CONNECTOR_TOOL_NAMES.act],
          caseAction: options.makeAction(snapshot),
          caseTools,
        };
      }
      return { instructions: caseTurnInstructions(found), onlyTools: caseTurnTools(), caseTools };
    },

    /**
     * A turn that went well is quiet when it left a trace on the case: a note, a new question or the
     * closing is in the case and the feed already. The person's answer is not the turn's doing. A turn
     * that left none is reported, so a turn that did nothing is never silent. The runner asks only about a
     * run that ended well, so a failed one is always reported.
     */
    async quiet(goal) {
      if (goal.caseId === undefined) return false;
      const start = atStart.get(goal.id);
      if (start === undefined) return false;
      const found = await options.cases.get(goal.caseId);
      return found?.history.slice(start).some((event) => event.kind !== 'answered') === true;
    },

    async ended(goal) {
      if (goal.caseId === undefined) return false;
      const start = atStart.get(goal.id);
      atStart.delete(goal.id);
      if (start === undefined) return false;
      return (await options.goals.get(goal.id))?.pendingCaseAnswer !== undefined;
    },
  };
}
