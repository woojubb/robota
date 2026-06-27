/**
 * TEST-005: shared constants for the real-model goal cassette. The record script and the replay
 * test MUST build the objective identically so the request hash matches across record/replay
 * (the workspace path is scrubbed/rewritten by the cassette provider).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Committed cassette of a real-model goal run. */
export const GOAL_CASSETTE_PATH = join(here, 'goal-satisfied.cassette.json');

/** Iteration budget for the recorded run. */
export const GOAL_MAX_ITERATIONS = 6;

/** The goal objective, embedding the absolute workspace path so the model writes into the workspace. */
export function buildGoalObjective(cwd: string): string {
  return (
    `Create a file named GOAL.txt at the absolute path ${cwd}/GOAL.txt containing exactly the text "done". ` +
    `Use the Bash tool, for example: printf 'done' > "${cwd}/GOAL.txt". ` +
    `After the file exists, report the goal as satisfied.`
  );
}
