import { randomUUID } from 'node:crypto';

import { buildCliArgs, buildTrustArgs, cliPackageSpec } from './build-invocation.mjs';

/**
 * @typedef {object} IActionIo
 * @property {NodeJS.ProcessEnv} env The step's environment; `action.yml` maps each input to a `ROBOTA_*` variable.
 * @property {(packageSpec: string, env: NodeJS.ProcessEnv) => string} install
 *   Installs the CLI outside the checkout and returns the path of its entry script.
 * @property {(entry: string, args: string[], env: NodeJS.ProcessEnv) => string} run
 *   Runs the entry script with Node (never through a shell or a package runner) in the checkout and
 *   returns its stdout.
 * @property {(text: string) => void} appendOutput Appends to the file `$GITHUB_OUTPUT` names.
 * @property {(text: string) => void} log
 */

const INPUT_VARIABLES = [
  'ROBOTA_TASK',
  'ROBOTA_MODEL',
  'ROBOTA_OUTPUT',
  'ROBOTA_MAX_TURNS',
  'ROBOTA_LOAD_PROJECT',
  'ROBOTA_API_KEY',
  'ROBOTA_CLI_VERSION',
];

/** How many lines of a failed step's own output the error repeats. */
const MAX_DETAIL_LINES = 3;

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
 * Why a step failed, without its command line: the CLI's command line holds the task, which is
 * untrusted text.
 *
 * @param {unknown} error
 * @returns {string}
 */
function failureReason(error) {
  if (error !== null && typeof error === 'object') {
    if ('signal' in error && typeof error.signal === 'string') {
      return `it was stopped by ${error.signal}`;
    }
    if ('status' in error && typeof error.status === 'number') {
      return `it exited with code ${error.status}`;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * The first lines a failed step printed, when it printed any.
 *
 * @param {unknown} error
 * @returns {string}
 */
function failureOutput(error) {
  if (error === null || typeof error !== 'object' || !('stdout' in error)) return '';
  const stdout = typeof error.stdout === 'string' ? error.stdout.trim() : '';
  return stdout === '' ? '' : `: ${stdout.split('\n').slice(0, MAX_DETAIL_LINES).join(' ')}`;
}

/**
 * Run one named step, turning its failure into an error that says which step failed.
 *
 * @template T
 * @param {string} step
 * @param {() => T} action
 * @param {{ withOutput: boolean }} options
 * @returns {T}
 */
function runStep(step, action, options) {
  try {
    return action();
  } catch (error) {
    const output = options.withOutput ? failureOutput(error) : '';
    throw new Error(`${step} failed: ${failureReason(error)}${output}`, { cause: error });
  }
}

/**
 * Run the action: install the CLI, optionally trust the checkout, run the CLI on the task, and set
 * the `result` output. Returns the process exit code; a failure is reported as an Actions `::error::`
 * line.
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
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...io.env };
  // The inputs reach the CLI only as argv (and the key as ANTHROPIC_API_KEY), never as these names.
  for (const name of INPUT_VARIABLES) delete env[name];
  if (io.env.ROBOTA_API_KEY) env.ANTHROPIC_API_KEY = io.env.ROBOTA_API_KEY;
  try {
    const spec = cliPackageSpec(io.env.ROBOTA_CLI_VERSION || 'latest');
    const entry = runStep('Installing the Robota CLI', () => io.install(spec, env), {
      withOutput: false,
    });
    if (loadProject) {
      // Its output says why trust was refused (for example, a checkout with no Git identity).
      runStep('Trusting the checkout', () => io.run(entry, buildTrustArgs(), env), {
        withOutput: true,
      });
    }
    const args = buildCliArgs({
      task,
      model: io.env.ROBOTA_MODEL ?? '',
      output: io.env.ROBOTA_OUTPUT || 'text',
      maxTurns: io.env.ROBOTA_MAX_TURNS ?? '',
      loadProject,
    });
    // The CLI's own output is the agent's reply, which is untrusted: it is not repeated here.
    const result = runStep('The Robota CLI', () => io.run(entry, args, env), { withOutput: false });
    // Random tokens the agent's reply cannot predict: one delimits the multi-line output value,
    // the other stops the runner from reading workflow commands out of the reply in the log.
    const token = randomUUID();
    io.appendOutput(`result<<ROBOTA_RESULT_${token}\n${result}\nROBOTA_RESULT_${token}\n`);
    io.log(`::stop-commands::${token}`);
    io.log(result);
    io.log(`::${token}::`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.log(`::error::${escapeCommandData(`Robota Action: ${message}`)}`);
    return 1;
  }
}
