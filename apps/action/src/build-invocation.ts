/** The inputs a workflow supplies to this action. Every one of them is untrusted. */
export interface IActionInputs {
  task: string;
  model: string;
  output: string;
  maxTurns: string;
}

/** The resolved child-process invocation: an executable plus a literal argv vector. */
export interface ICliInvocation {
  file: string;
  args: string[];
}

/**
 * Build the `npx @robota-sdk/agent-cli` invocation as a FILE + ARGV VECTOR.
 *
 * SEC-006: this used to be `execSync(args.join(' '))`. `execSync` always runs its string through a
 * shell, so joining an argv array on spaces handed every shell metacharacter in every input straight
 * to `/bin/sh`. A workflow wiring `task: ${{ github.event.issue.body }}` — the documented use for this
 * action — let any issue author run arbitrary commands on the runner, with the repository's
 * `ANTHROPIC_API_KEY` exported into that process's environment.
 *
 * Returning a vector (rather than a string) is what makes the invocation safe by construction: there is
 * no quoting to get right, because no shell ever parses these values. This lives in its own module so
 * it can be tested without importing the action entry point, which runs on import.
 */
export function buildCliInvocation(inputs: IActionInputs): ICliInvocation {
  const args: string[] = [
    '--yes',
    '@robota-sdk/agent-cli',
    '-p',
    inputs.task,
    '--output-format',
    inputs.output,
  ];
  if (inputs.model) args.push('--model', inputs.model);
  if (inputs.maxTurns) args.push('--max-turns', inputs.maxTurns);
  return { file: 'npx', args };
}
