import type { ICliRuntimeContext } from '../product/runtime-context.js';
/**
 * An interactive start in an untrusted workspace asks whether to trust it, the way the
 * headless refusal tells a run with no one to ask. It asks before anything from the project is
 * composed, so "no" starts Restricted exactly as before and "yes" starts Trusted with no restart.
 */
import { createInterface } from 'node:readline/promises';

import { BrokeredWorkspaceTrustService } from './brokered-workspace-trust.js';
import { formatProjectContributionPreview } from './project-contribution-preview.js';

import { subcommandWord, type IParsedCliArgs } from '../utils/cli-args.js';
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
    | 'literalPositionals'
    | 'configure'
    | 'configureProvider'
    | 'setCurrent'
    | 'continueMode'
    | 'resumeId'
  >,
): boolean {
  const headless = args.printMode || args.goal !== undefined || args.serve;
  const setup =
    subcommandWord(args) === 'init' ||
    subcommandWord(args) === 'mcp' ||
    subcommandWord(args) === 'acp' ||
    args.configure ||
    args.configureProvider !== undefined ||
    args.setCurrent;
  const resumes = args.continueMode || args.resumeId !== undefined;
  return !headless && !setup && !resumes;
}

export interface IInteractiveTrustPromptOptions {
  readonly productRuntime: ICliRuntimeContext;
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

/** Whether a person can be asked about this workspace: it is not trusted, and a grant could change that. */
export function canAskToTrust(
  access: TWorkspaceProjectAccess,
): access is Extract<TWorkspaceProjectAccess, { readonly status: 'restricted' }> {
  return access.status === 'restricted' && ASKABLE_STATES.has(access.trustState);
}

/** What a person is asked about a workspace not trusted yet: its folder and what trust would load. */
export function trustQuestionFor(
  access: TWorkspaceProjectAccess,
  cwd: string,
  runtime: ICliRuntimeContext,
): { readonly folder: string; readonly loads: readonly string[] } | undefined {
  if (!canAskToTrust(access)) return undefined;
  return {
    folder: access.displayPath ?? cwd,
    // The source rows only: the header and the closing note describe the listing, not the folder.
    // This is what `trust status --json` and the desktop dialog show — a row whose state
    // could not be determined (every row, on a host without Linux's pinned handle-walk) says nothing
    // worth showing there, unlike the full terminal preview (`formatProjectContributionPreview`
    // itself, still complete — the TUI's own interactive prompt and plain `trust status` keep it).
    loads: formatProjectContributionPreview(access.identity, cwd, runtime)
      .split('\n')
      .filter((line) => line.startsWith('  [') && !line.startsWith('  [unavailable]')),
  };
}

/** Record the grant a person just gave, in the user's trust store. */
export async function prepareWorkspaceTrustApproval(
  cwd: string,
  runtime: ICliRuntimeContext,
): Promise<{ candidate: string; grant(): Promise<TWorkspaceProjectAccess>; release(): Promise<void> }> {
  const service = await BrokeredWorkspaceTrustService.create(runtime);
  const candidate = await service.prepare(cwd);
  return {
    candidate,
    grant: () => service.grant(cwd, candidate),
    release: () => service.release(candidate),
  };
}

export async function grantWorkspaceTrust(
  cwd: string,
  runtime: ICliRuntimeContext,
  candidate: string,
): Promise<TWorkspaceProjectAccess> {
  return (await BrokeredWorkspaceTrustService.create(runtime)).grant(cwd, candidate);
}

/** The access this run starts with: the decision made, or a grant the person just gave. */
export async function askToTrustWorkspace(
  access: TWorkspaceProjectAccess,
  cwd: string,
  options: IInteractiveTrustPromptOptions,
): Promise<TWorkspaceProjectAccess> {
  if (!options.interactive || options.accessFixed) return access;
  if (!canAskToTrust(access)) return access;
  const write = options.write ?? ((text: string) => void process.stdout.write(text));
  let approval: Awaited<ReturnType<typeof prepareWorkspaceTrustApproval>> | undefined;
  if (options.grant === undefined) {
    try {
      approval = await prepareWorkspaceTrustApproval(cwd, options.productRuntime);
    } catch (error) {
      write(`Could not prepare workspace trust (${error instanceof Error ? error.message : String(error)}). Starting Restricted.\n`);
      return access;
    }
  }
  write(
    [
      `This folder is not trusted: ${access.displayPath ?? cwd}`,
      `Trusting it lets ${options.productRuntime.config.identity.displayName} load the project's own settings, hooks, plugins, skills, agent ` +
        `definitions, provider overrides and MCP servers. Without it, ${options.productRuntime.config.identity.displayName} starts Restricted.`,
      formatProjectContributionPreview(access.identity, cwd, options.productRuntime),
    ].join('\n'),
  );
  let confirmed: boolean;
  try {
    confirmed = await (options.confirm ?? confirmOnTerminal)('Trust this folder? [y/N] ');
  } catch (error) {
    if (approval !== undefined) await approval.release().catch(() => undefined);
    throw error;
  }
  if (!confirmed) {
    if (approval !== undefined) await approval.release().catch(() => undefined);
    write(`Starting Restricted. Trust it later with: ${options.productRuntime.config.identity.cliName} trust --yes\n`);
    return access;
  }
  try {
    return await (options.grant ?? (() => approval!.grant()))(cwd);
  } catch (error) {
    if (approval !== undefined) await approval.release().catch(() => undefined);
    // The person said yes and it did not take: say so and start as a no would, not crash the start.
    write(
      `Could not record trust (${error instanceof Error ? error.message : String(error)}). ` +
        'Starting Restricted.\n',
    );
    return access;
  }
}
