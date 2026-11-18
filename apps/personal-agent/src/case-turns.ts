/**
 * How the turn on a case is started, run and reported: when the person answers a case's question the
 * agent takes one more turn on that case, as a goal of its own, to decide what the answer means. The
 * goal machinery is the ordinary one; this is the part that knows about cases. The turn is read-only
 * and has only the tools to look and to keep the case, so nothing in the case's notes, which came
 * from content other people wrote, can make it act outside the agent's own record.
 */
import {
  GoalRefusedError,
  caseTurnInstructions,
  caseTurnPrompt,
  caseTurnTools,
  CONNECTOR_TOOL_NAMES,
} from '@robota-sdk/agent-product/personal';

import type { CaseBook, GoalBook, ICase, IGoal } from '@robota-sdk/agent-product/personal';
import type { IGoalShape } from './goal-runner.js';
import type { ICaseAction } from './goal-runner.js';
import type { ICaseActionSnapshot } from './case-action.js';

export interface ICaseTurns {
  /** Keep only the authority captured for the answer that was actually accepted. */
  remember(answered: ICase, snapshot: ICaseActionSnapshot | undefined): void;
  /** Make the case's goal due: one goal for each case, created by its first answer and run again by each later one. */
  onAnswered(answered: ICase): Promise<void>;
  shape(goal: IGoal): Promise<IGoalShape | undefined>;
  quiet(goal: IGoal): Promise<boolean>;
  /**
   * Called when a case turn has ended, whether it went well or not. When the person answered the case
   * while it ran, that answer found the goal busy and started nothing, and the turn that ended did not
   * read it: the goal is made due again and this says so, for the host to run what is due once the run
   * is over. A turn follows an answer at most once, since the next turn begins after it.
   */
  ended(goal: IGoal): Promise<boolean>;
}

export function createCaseTurns(options: {
  readonly goals: GoalBook;
  readonly cases: CaseBook;
  readonly makeAction?: (snapshot: ICaseActionSnapshot) => ICaseAction;
}): ICaseTurns {
  /** How many events a case had when its turn began, to tell what the turn left and what came during it. */
  const atStart = new Map<string, number>();
  const answers = new Map<string, ICaseActionSnapshot>();

  async function onAnswered(answered: ICase): Promise<void> {
    const existing = (await options.goals.list()).find((goal) => goal.caseId === answered.id);
    if (existing === undefined) {
      await options.goals.create({
        title: `Case: ${answered.title}`,
        instructions: caseTurnPrompt(),
        readOnly: true,
        caseId: answered.id,
      });
      return;
    }
    try {
      await options.goals.runAgain(existing.id);
    } catch (error) {
      // A case has one question at a time, so an answer normally comes after the turn that asked it has
      // ended. One that comes while that turn is still ending is picked up by `ended`; one for a goal the
      // person paused is not started: the answer is already recorded on the case.
      if (!(error instanceof GoalRefusedError)) throw error;
    }
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

    async shape(goal) {
      if (goal.caseId === undefined) return undefined;
      // Read when the turn begins, not when the answer came: the case may have moved on since.
      const found = await options.cases.get(goal.caseId);
      if (found !== undefined) atStart.set(goal.id, found.history.length);
      const snapshot =
        found?.lastAnsweredFeedItemId === undefined
          ? undefined
          : answers.get(found.lastAnsweredFeedItemId);
      if (found?.lastAnsweredFeedItemId !== undefined) answers.delete(found.lastAnsweredFeedItemId);
      if (found === undefined || found.state === 'closed') {
        return {
          instructions:
            'The case is gone or already settled. Say so in one line and do nothing else.',
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
      if (snapshot !== undefined && options.makeAction !== undefined) {
        return {
          instructions: caseTurnInstructions(found, { allowApprovedActions: true }),
          onlyTools: [...caseTurnTools(), CONNECTOR_TOOL_NAMES.act],
          caseAction: options.makeAction(snapshot),
        };
      }
      return { instructions: caseTurnInstructions(found), onlyTools: caseTurnTools() };
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
      const found = await options.cases.get(goal.caseId);
      if (found === undefined) return false;
      // The case's last event is an answer, so no question waits, and it came after the turn began.
      const last = found.history.length - 1;
      if (found.history[last]?.kind !== 'answered' || last < start) return false;
      await onAnswered(found);
      return true;
    },
  };
}
