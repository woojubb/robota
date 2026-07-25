/**
 * Single source of truth for the `/workflows` subcommand surface (WORKFLOW-005 P3).
 *
 * The subcommand list, the `ICommand.argumentHint`s the CLI shows, the top-level usage block, and
 * every per-subcommand `Usage:` line an executor emits on a bad argument all derive from
 * `WORKFLOWS_SUBCOMMANDS` — so a hint and its usage text cannot drift apart. Lives in its own module
 * (not `workflows-command-module.ts`) so the executors can import the usage text without a cycle.
 */

/** Metadata for one `/workflows` subcommand. */
export interface IWorkflowsSubcommand {
  readonly name: string;
  readonly description: string;
  /** Argument grammar, e.g. `<file.json>`. Omitted for argument-less subcommands. */
  readonly argumentHint?: string;
  /** Whether the agent (not just the user) may invoke it. */
  readonly modelInvocable: boolean;
}

/** The authoring subcommands share one argument grammar (`parseCreateArgs`). */
const AUTHORING_HINT = '"<description>" [--input key=value] [--name <name>]';
/** The file-taking subcommands share one argument grammar (`parseFileArg`). */
const FILE_HINT = '<file.json>';

export const WORKFLOWS_SUBCOMMANDS: readonly IWorkflowsSubcommand[] = [
  {
    name: 'create',
    description: 'Author a workflow from a natural-language description and run it immediately',
    argumentHint: AUTHORING_HINT,
    modelInvocable: true,
  },
  {
    name: 'build',
    description:
      'Author a workflow from a natural-language description and save it for review (no run)',
    argumentHint: AUTHORING_HINT,
    modelInvocable: true,
  },
  {
    name: 'list',
    description: 'List available workflow nodes (built-ins + nodes saved in this workspace)',
    modelInvocable: false,
  },
  {
    name: 'catalog',
    description: 'List workflow files in the local .workflows catalog',
    modelInvocable: false,
  },
  {
    name: 'validate',
    description: 'Validate a workflow file against the node catalog',
    argumentHint: FILE_HINT,
    modelInvocable: false,
  },
  {
    name: 'run',
    description: 'Run a workflow file',
    argumentHint: FILE_HINT,
    modelInvocable: false,
  },
];

/** `Usage: /workflows <name> <hint>` — the one line an executor emits on a bad argument. */
export function subcommandUsage(name: string): string {
  const sub = WORKFLOWS_SUBCOMMANDS.find((s) => s.name === name);
  if (!sub) throw new Error(`Unknown /workflows subcommand: ${name}`);
  return `Usage: /workflows ${sub.name}${sub.argumentHint ? ` ${sub.argumentHint}` : ''}`;
}

/**
 * A compact invocation shape for the usage block — the subcommand plus the FIRST token of its
 * argument hint. The full grammar stays in each subcommand's own `Usage:` line.
 */
function compactInvocation(sub: IWorkflowsSubcommand): string {
  return sub.argumentHint ? `${sub.name} ${sub.argumentHint.split(' ')[0]}` : sub.name;
}

/** The multi-line usage block shown for bare `/workflows` and unknown subcommands. */
export function renderWorkflowsUsage(): string {
  const names = WORKFLOWS_SUBCOMMANDS.map((s) => s.name).join('|');
  const invocations = WORKFLOWS_SUBCOMMANDS.map(compactInvocation);
  const width = Math.max(...invocations.map((i) => i.length));
  const lines = WORKFLOWS_SUBCOMMANDS.map(
    (sub, i) => `  ${invocations[i]!.padEnd(width)}  ${sub.description}`,
  );
  return [`Usage: /workflows <${names}>`, ...lines].join('\n');
}
