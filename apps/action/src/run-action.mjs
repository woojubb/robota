import { randomUUID } from 'node:crypto';

import { buildCliArgs, buildTrustArgs, cliPackageSpec } from './build-invocation.mjs';

/**
 * @typedef {object} IActionIo
 * @property {NodeJS.ProcessEnv} env The step's environment; `action.yml` maps each input to a `ACTION_*` variable.
 * @property {(packageSpec: string, env: NodeJS.ProcessEnv) => string} install
 *   Installs the CLI outside the checkout and returns the path of its entry script.
 * @property {(entry: string, args: string[], env: NodeJS.ProcessEnv, input?: string) => string} run
 *   Runs the entry script with Node (never through a shell or a package runner) in the checkout,
 *   writing `input` to its stdin when given, and returns its stdout.
 * @property {(text: string) => void} appendOutput Appends to the file `$GITHUB_OUTPUT` names.
 * @property {(text: string) => void} log
 */

const INPUT_VARIABLES = [
  'ACTION_TASK',
  'ACTION_MODEL',
  'ACTION_OUTPUT',
  'ACTION_MAX_TURNS',
  'ACTION_LOAD_PROJECT',
  'ACTION_API_KEY',
  'ACTION_CLI_VERSION',
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
    if ('code' in error && error.code === 'ENOBUFS') {
      return 'its output was longer than the action reads';
    }
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
  const task = io.env.ACTION_TASK ?? '';
  if (task.trim() === '') {
    io.log('::error::Agent Action: the task input is required.');
    return 1;
  }
  const loadProject = io.env.ACTION_LOAD_PROJECT === 'true';
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...io.env };
  // The inputs reach the CLI as stdin (the task), argv and ANTHROPIC_API_KEY, never as these names.
  for (const name of INPUT_VARIABLES) delete env[name];
  // npm and the install scripts it runs never see the key.
  const { ANTHROPIC_API_KEY: _jobKey, ...installEnv } = env;
  if (io.env.ACTION_API_KEY) env.ANTHROPIC_API_KEY = io.env.ACTION_API_KEY;
  try {
    const spec = cliPackageSpec(io.env.ACTION_CLI_VERSION || 'latest', io.env.PRODUCT_PACKAGE_SCOPE ?? '');
    const entry = runStep('Installing the selected CLI', () => io.install(spec, installEnv), {
      withOutput: false,
    });
    if (loadProject) {
      // Its output says why trust was refused (for example, a checkout with no Git identity).
      runStep('Trusting the checkout', () => io.run(entry, buildTrustArgs(), env), {
        withOutput: true,
      });
    }
    const args = buildCliArgs({
      model: io.env.ACTION_MODEL ?? '',
      output: io.env.ACTION_OUTPUT || 'text',
      maxTurns: io.env.ACTION_MAX_TURNS ?? '',
      loadProject,
    });
    // The runner reads no workflow commands out of what the CLI prints while it runs (its stderr
    // streams to the log).
    const runToken = randomUUID();
    io.log(`::stop-commands::${runToken}`);
    let result;
    try {
      // The task goes on stdin, never as an argument. The CLI's own output is the agent's reply,
      // which is untrusted: a failure does not repeat it.
      result = runStep('The selected CLI', () => io.run(entry, args, env, task), {
        withOutput: false,
      });
    } finally {
      io.log(`::${runToken}::`);
    }
    // Tokens made after the reply exists, so the reply cannot contain them: one wraps the reply in
    // the log, the other delimits the multi-line output value.
    const replyToken = randomUUID();
    io.log(`::stop-commands::${replyToken}`);
    io.log(result);
    io.log(`::${replyToken}::`);
    const delimiter = `ACTION_RESULT_${randomUUID()}`;
    io.appendOutput(`result<<${delimiter}\n${result}\n${delimiter}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.log(`::error::${escapeCommandData(`Agent Action: ${message}`)}`);
    return 1;
  }
}
