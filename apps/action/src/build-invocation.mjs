/**
 * @typedef {object} IActionInputs The inputs a workflow supplies to this action. The task in
 * particular is untrusted: it is often built from issue or pull request text.
 * @property {string} task
 * @property {string} model
 * @property {string} output
 * @property {string} maxTurns
 * @property {boolean} loadProject Trust the checkout so its settings, hooks, skills and MCP servers load.
 */

/**
 * The CLI's arguments as a literal argv vector, so no shell ever parses an input and a task built
 * from issue or pull request text cannot inject commands (SEC-006).
 *
 * Options come first and the task last, after `--`, so a task that starts with `-` is still the
 * prompt and never an option. Unless the workflow asks to load the project, the CLI runs with
 * `--safe-mode`: a pull request's own settings, hooks and MCP servers must not run on the runner just
 * because the job checked it out.
 *
 * @param {IActionInputs} inputs
 * @returns {string[]}
 */
export function buildCliArgs(inputs) {
  const args = [...(inputs.loadProject ? [] : ['--safe-mode']), '--output-format', inputs.output];
  if (inputs.model) args.push('--model', inputs.model);
  if (inputs.maxTurns) args.push('--max-turns', inputs.maxTurns);
  args.push('-p', '--', inputs.task);
  return args;
}

/**
 * The run that trusts the checked-out repository first, when the workflow asked to load the project.
 *
 * @returns {string[]}
 */
export function buildTrustArgs() {
  return ['trust', '--yes'];
}

/** A dist-tag or version: letters, digits, `.`, `+`, `-`. Anything else could name another package. */
const CLI_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;

/**
 * The npm package spec for the CLI version the workflow asked for.
 *
 * @param {string} version
 * @returns {string}
 */
export function cliPackageSpec(version) {
  if (!CLI_VERSION.test(version)) {
    throw new Error(`cli-version must be a version or dist-tag, not "${version}".`);
  }
  return `@robota-sdk/agent-cli@${version}`;
}
