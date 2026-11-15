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
} from '@robota-sdk/agent-product/personal';

import type { CaseBook, GoalBook, ICase, IGoal } from '@robota-sdk/agent-product/personal';
import type { IGoalShape } from './goal-runner.js';

export interface ICaseTurns {
  /** Make the case's goal due: one goal for each case, created by its first answer and run again by each later one. */
  onAnswered(answered: ICase): Promise<void>;
  shape(goal: IGoal): Promise<IGoalShape | undefined>;
  quiet(goal: IGoal): Promise<boolean>;
}

export function createCaseTurns(options: {
  readonly goals: GoalBook;
  readonly cases: CaseBook;
}): ICaseTurns {
  /** How many events a case had when its turn began, to tell whether the turn left a trace on it. */
  const atStart = new Map<string, number>();

  return {
    async onAnswered(answered) {
      const existing = (await options.goals.list()).find((goal) => goal.caseId === answered.id);
      if (existing === undefined) {
        await options.goals.create({
          title: `Case: ${answered.title}`,
          instructions: caseTurnPrompt(answered),
          readOnly: true,
          caseId: answered.id,
        });
        return;
      }
      try {
        await options.goals.runAgain(existing.id);
      } catch (error) {
        // A case has one question at a time and its answer comes after the turn that asked it, so the
        // goal has normally ended. One still ending (a person can answer in that moment), or one the
        // person paused, is not started twice: the answer is already recorded on the case.
        if (!(error instanceof GoalRefusedError)) throw error;
      }
    },

    async shape(goal) {
      if (goal.caseId === undefined) return undefined;
      // Read when the turn begins, not when the answer came: the case may have moved on since.
      const found = await options.cases.get(goal.caseId);
      if (found !== undefined) atStart.set(goal.id, found.history.length);
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
      return { instructions: caseTurnInstructions(found), onlyTools: caseTurnTools() };
    },

    /**
     * A turn that went well is quiet when it left a trace on the case: a note, a new question or the
     * closing is in the case and the feed already. A turn that left none is reported, so a turn that did
     * nothing is never silent. The runner asks only about a run that ended well, so a failed one is always reported.
     */
    async quiet(goal) {
      if (goal.caseId === undefined) return false;
      const start = atStart.get(goal.id);
      atStart.delete(goal.id);
      if (start === undefined) return false;
      const found = await options.cases.get(goal.caseId);
      return found !== undefined && found.history.length > start;
    },
  };
}
