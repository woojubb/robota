/**
 * An interactive start in an untrusted workspace asks whether to trust it (issue #3268), the way the
 * headless refusal tells a run with no one to ask. It asks before anything from the project is
 * composed, so "no" starts Restricted exactly as before and "yes" starts Trusted with no restart.
 */
import { createInterface } from 'node:readline/promises';

import { createNodeWorkspaceTrustService } from '@robota-sdk/agent-framework';

import { userPaths } from '../product/user-paths.js';
import { ROBOTA_PROJECT_STATE_DIRECTORIES } from '../product/robota-project-state-directories.js';
import { formatProjectContributionPreview } from './project-contribution-preview.js';

import type { IParsedCliArgs } from '../utils/cli-args.js';
import type { TWorkspaceProjectAccess } from '@robota-sdk/agent-framework';

/** States a grant can change. A directory outside Git has no identity to grant, and a store that
 * cannot be read cannot record one. */
const ASKABLE_STATES = new Set(['untrusted', 'revoked', 'stale/replaced']);

/**
 * Whether this run starts a new TUI session, the one start the question is for. A setup command runs
 * no session. A resumed or continued one must keep the store it was saved in: a Restricted
 * session is kept in the user store, and a grant would send the resume to the project store instead.
 */
export function startsNewTuiSession(
  args: Pick<
    IParsedCliArgs,
    | 'printMode'
    | 'goal'
    | 'serve'
    | 'positional'
    | 'configure'
    | 'configureProvider'
    | 'setCurrent'
    | 'continueMode'
    | 'resumeId'
  >,
): boolean {
  const headless = args.printMode || args.goal !== undefined || args.serve;
  const setup =
    args.positional[0] === 'init' ||
    args.positional[0] === 'mcp' ||
    args.configure ||
    args.configureProvider !== undefined ||
    args.setCurrent;
  const resumes = args.continueMode || args.resumeId !== undefined;
  return !headless && !setup && !resumes;
}

export interface IInteractiveTrustPromptOptions {
  /** A person is at this run: a new TUI session ({@link startsNewTuiSession}) on a terminal. */
  readonly interactive: boolean;
  /** Access decided for this run and not to be reopened: safe mode, a `/cd` into a Restricted folder, an embedder's. */
  readonly accessFixed: boolean;
  readonly confirm?: (question: string) => Promise<boolean>;
  readonly write?: (text: string) => void;
  readonly grant?: (cwd: string) => Promise<TWorkspaceProjectAccess>;
}

async function confirmOnTerminal(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

function grantWithTrustStore(cwd: string): Promise<TWorkspaceProjectAccess> {
  return createNodeWorkspaceTrustService(
    userPaths().workspaceTrust,
    ROBOTA_PROJECT_STATE_DIRECTORIES,
  ).grant(cwd);
}

/** The access this run starts with: the decision made, or a grant the person just gave. */
export async function askToTrustWorkspace(
  access: TWorkspaceProjectAccess,
  cwd: string,
  options: IInteractiveTrustPromptOptions,
): Promise<TWorkspaceProjectAccess> {
  if (!options.interactive || options.accessFixed) return access;
  if (access.status !== 'restricted' || !ASKABLE_STATES.has(access.trustState)) return access;
  const write = options.write ?? ((text: string) => void process.stdout.write(text));
  write(
    [
      `This folder is not trusted: ${access.displayPath ?? cwd}`,
      "Trusting it lets Robota load the project's own settings, hooks, plugins, skills, agent " +
        'definitions, provider overrides and MCP servers. Without it, Robota starts Restricted.',
      formatProjectContributionPreview(access.identity, cwd),
    ].join('\n'),
  );
  const confirmed = await (options.confirm ?? confirmOnTerminal)('Trust this folder? [y/N] ');
  if (!confirmed) {
    write('Starting Restricted. Trust it later with: robota trust --yes\n');
    return access;
  }
  try {
    return await (options.grant ?? grantWithTrustStore)(cwd);
  } catch (error) {
    // The person said yes and it did not take: say so and start as a no would, not crash the start.
    write(
      `Could not record trust (${error instanceof Error ? error.message : String(error)}). ` +
        'Starting Restricted.\n',
    );
    return access;
  }
}
