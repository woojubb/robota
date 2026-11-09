/**
 * Shared constants for the real-model goal cassette. The record script and the replay
 * test MUST build the objective identically so the request hash matches across record/replay
 * (the workspace path is scrubbed/rewritten by the cassette provider).
 *
 * A cassette holds the shell commands the model wrote, so each shell family has its own: the
 * recording of a POSIX shell, and the PowerShell cassette Windows replays. The PowerShell one was
 * translated from the recording, not recorded (see its `provenance`); recording on Windows with
 * `scripts/record-goal-cassette.mts` replaces it.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvePlatformShell } from '@robota-sdk/agent-core/node';

const here = dirname(fileURLToPath(import.meta.url));

function usesPowerShell(): boolean {
  return resolvePlatformShell().kind === 'powershell';
}

/** The recording of a real model driving a POSIX shell. */
export const POSIX_GOAL_CASSETTE_PATH = join(here, 'goal-satisfied.cassette.json');

/** The PowerShell cassette Windows replays: translated from the POSIX recording, not recorded. */
export const POWERSHELL_GOAL_CASSETTE_PATH = join(here, 'goal-satisfied.powershell.cassette.json');

/** Committed cassette of the goal run for the shell this platform resolves. */
export const GOAL_CASSETTE_PATH = usesPowerShell()
  ? POWERSHELL_GOAL_CASSETTE_PATH
  : POSIX_GOAL_CASSETTE_PATH;

/** Iteration budget for the recorded run. */
export const GOAL_MAX_ITERATIONS = 6;

/** The goal objective, embedding the absolute workspace path so the model writes into the workspace. */
export function buildGoalObjective(cwd: string): string {
  const example = usesPowerShell()
    ? `[System.IO.File]::WriteAllText('${cwd}/GOAL.txt', 'done')`
    : `printf 'done' > "${cwd}/GOAL.txt"`;
  return (
    `Create a file named GOAL.txt at the absolute path ${cwd}/GOAL.txt containing exactly the text "done". ` +
    `Use the Bash tool, for example: ${example}. ` +
    `After the file exists, report the goal as satisfied.`
  );
}
