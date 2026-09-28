import { randomUUID } from 'node:crypto';

import { buildCliInvocation, buildTrustInvocation } from './build-invocation.mjs';

/**
 * @typedef {(file: string, args: string[], env: NodeJS.ProcessEnv) => string} TExec
 * Runs a file with a literal argv vector (never through a shell) and returns its stdout.
 */

/**
 * @typedef {object} IActionIo
 * @property {NodeJS.ProcessEnv} env The step's environment; `action.yml` maps each input to a `ROBOTA_*` variable.
 * @property {TExec} exec
 * @property {(text: string) => void} appendOutput Appends to the file `$GITHUB_OUTPUT` names.
 * @property {(text: string) => void} log
 */

/**
 * Escape a message the way `@actions/core` does, so a line break in it cannot start a second
 * workflow command.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeCommandData(text) {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

/**
 * Why the run failed, without the command line: it holds the task, which is untrusted text.
 * The CLI's own stderr already reached the log.
 *
 * @param {unknown} error
 * @returns {string}
 */
function failureReason(error) {
  if (
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    typeof error.status === 'number'
  ) {
    return `the CLI exited with code ${error.status}`;
  }
  return error instanceof Error ? error.message : String(error);
}

const INPUT_VARIABLES = [
  'ROBOTA_TASK',
  'ROBOTA_MODEL',
  'ROBOTA_OUTPUT',
  'ROBOTA_MAX_TURNS',
  'ROBOTA_LOAD_PROJECT',
  'ROBOTA_API_KEY',
];

/**
 * Run the action: optionally trust the checkout, run the CLI on the task, and set the `result` output.
 * Returns the process exit code; a failure is reported as an Actions `::error::` line.
 *
 * @param {IActionIo} io
 * @returns {number}
 */
export function runAction(io) {
  const task = io.env.ROBOTA_TASK ?? '';
  if (task.trim() === '') {
    io.log('::error::Robota Action: the task input is required.');
    return 1;
  }
  const loadProject = io.env.ROBOTA_LOAD_PROJECT === 'true';
  const invocation = buildCliInvocation({
    task,
    model: io.env.ROBOTA_MODEL ?? '',
    output: io.env.ROBOTA_OUTPUT || 'text',
    maxTurns: io.env.ROBOTA_MAX_TURNS ?? '',
    loadProject,
  });
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...io.env };
  // The inputs reach the CLI only as argv (and the key as ANTHROPIC_API_KEY), never as these names.
  for (const name of INPUT_VARIABLES) delete env[name];
  if (io.env.ROBOTA_API_KEY) env.ANTHROPIC_API_KEY = io.env.ROBOTA_API_KEY;
  try {
    if (loadProject) {
      const trust = buildTrustInvocation();
      io.exec(trust.file, trust.args, env);
    }
    const result = io.exec(invocation.file, invocation.args, env);
    // Random tokens the agent's reply cannot predict: one delimits the multi-line output value,
    // the other stops the runner from reading workflow commands out of the reply in the log.
    const token = randomUUID();
    io.appendOutput(`result<<ROBOTA_RESULT_${token}\n${result}\nROBOTA_RESULT_${token}\n`);
    io.log(`::stop-commands::${token}`);
    io.log(result);
    io.log(`::${token}::`);
    return 0;
  } catch (error) {
    io.log(`::error::${escapeCommandData(`Robota Action failed: ${failureReason(error)}`)}`);
    return 1;
  }
}
