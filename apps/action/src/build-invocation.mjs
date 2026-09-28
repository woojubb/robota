/**
 * @typedef {object} IActionInputs The inputs a workflow supplies to this action. Every one of them is untrusted.
 * @property {string} task
 * @property {string} model
 * @property {string} output
 * @property {string} maxTurns
 * @property {boolean} loadProject Trust the checkout so its settings, hooks, skills and MCP servers load.
 */

/**
 * @typedef {object} ICliInvocation The resolved child-process invocation: an executable plus a literal argv vector.
 * @property {string} file
 * @property {string[]} args
 */

const CLI = ['--yes', '@robota-sdk/agent-cli'];

/**
 * Build the `npx @robota-sdk/agent-cli` run as a FILE + ARGV VECTOR, so no shell ever parses an input:
 * a task built from issue or pull request text cannot inject commands (SEC-006).
 *
 * Unless the workflow asks to load the project, the CLI runs with `--safe-mode`: a pull request's own
 * settings, hooks and MCP servers must not run on the runner just because the job checked it out.
 *
 * @param {IActionInputs} inputs
 * @returns {ICliInvocation}
 */
export function buildCliInvocation(inputs) {
  const args = [
    ...CLI,
    ...(inputs.loadProject ? [] : ['--safe-mode']),
    '-p',
    inputs.task,
    '--output-format',
    inputs.output,
  ];
  if (inputs.model) args.push('--model', inputs.model);
  if (inputs.maxTurns) args.push('--max-turns', inputs.maxTurns);
  return { file: 'npx', args };
}

/**
 * The run that trusts the checked-out repository first, when the workflow asked to load the project.
 *
 * @returns {ICliInvocation}
 */
export function buildTrustInvocation() {
  return { file: 'npx', args: [...CLI, 'trust', '--yes'] };
}
