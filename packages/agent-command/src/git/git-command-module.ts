/**
 * BEHAVIOR-2437: `/git` — one command whose `execute` parses its verb (`status` | `diff` | `commit`),
 * with the three verbs on `subcommands` for `/help` and autocomplete. Host-only (`modelInvocable:
 * false`); the confirmation lives in the `commit` verb, because `requiresPermission` is not enforced
 * on the user path (`SystemCommandExecutor.executeCommand` calls `execute` directly).
 */
import { executeGitCommit } from './git-commit.js';
import { executeGitDiff } from './git-diff.js';
import { createGitProcess } from './git-process.js';
import { executeGitStatus } from './git-status.js';

import type { IGitProcessPort } from './git-process.js';
import type {
  ICommandHostUserInteraction,
  ICommandHostWorkspace,
  ICommandModule,
  ISystemCommand,
} from '@robota-sdk/agent-framework';
import type { ICommand, ICommandResult, ICommandSource } from '@robota-sdk/agent-interface-command';

export const GIT_COMMAND_DESCRIPTION =
  'Show the git status, view a diff, or commit the staged changes after confirming';
export const GIT_COMMAND_ARGUMENT_HINT =
  'status | diff [--staged | <rev> | <a>..<b>] [-- <path> ...] | commit [<subject>]';
export const GIT_COMMAND_USAGE =
  'Usage: /git status | /git diff [--staged | <rev> | <a>..<b>] [-- <path> ...] | /git commit [<subject>]';

const SOURCE = 'git';

function verbEntry(name: string, description: string, argumentHint?: string): ICommand {
  return {
    name,
    description,
    source: SOURCE,
    modelInvocable: false,
    ...(argumentHint ? { argumentHint } : {}),
  };
}

export function createGitCommandEntry(): ICommand {
  return {
    name: 'git',
    displayName: 'Git',
    description: GIT_COMMAND_DESCRIPTION,
    source: SOURCE,
    modelInvocable: false,
    argumentHint: GIT_COMMAND_ARGUMENT_HINT,
    subcommands: [
      verbEntry('status', 'Show the branch and the staged, unstaged and untracked paths'),
      verbEntry(
        'diff',
        'Show the unstaged diff, the staged diff, or a diff against one or two revisions',
        '[--staged | <rev> | <a>..<b>] [-- <path> ...]',
      ),
      verbEntry(
        'commit',
        'Commit the staged changes with a Conventional Commits subject, after confirming',
        '[<subject>]',
      ),
    ],
  };
}

/** What the verbs need from the host: the working directory and the ask-the-user port. */
export type TGitCommandContext = Pick<ICommandHostWorkspace, 'getCwd'> &
  ICommandHostUserInteraction;

export async function executeGitCommand(
  context: TGitCommandContext,
  args: string,
  port: IGitProcessPort = createGitProcess(),
): Promise<ICommandResult> {
  const trimmed = args.trim();
  const split = trimmed.search(/\s/);
  const verb = split === -1 ? trimmed : trimmed.slice(0, split);
  const rest = split === -1 ? '' : trimmed.slice(split + 1).trim();
  const cwd = context.getCwd();

  switch (verb) {
    case 'status':
      if (rest.length > 0) {
        return {
          success: false,
          message: `\`/git status\` takes no arguments.\n${GIT_COMMAND_USAGE}`,
        };
      }
      return executeGitStatus(port, cwd);
    case 'diff':
      return executeGitDiff(port, cwd, rest);
    case 'commit':
      return executeGitCommit(port, cwd, rest, context.getUserInteraction());
    default:
      return {
        success: false,
        message:
          verb.length === 0
            ? GIT_COMMAND_USAGE
            : `Unknown /git verb "${verb}".\n${GIT_COMMAND_USAGE}`,
      };
  }
}

function createGitSystemCommand(port: IGitProcessPort): ISystemCommand {
  const entry = createGitCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    argumentHint: entry.argumentHint,
    example: '/git status',
    subcommands: entry.subcommands,
    requiresPermission: true,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'blocking',
    execute: (context, args) => executeGitCommand(context, args, port),
  };
}

export class GitCommandSource implements ICommandSource {
  readonly name = SOURCE;

  getCommands(): ICommand[] {
    return [createGitCommandEntry()];
  }
}

export interface IGitCommandModuleOptions {
  /** The process seam; the production `createGitProcess()` by default, injectable for tests. */
  port?: IGitProcessPort;
}

export function createGitCommandModule(options: IGitCommandModuleOptions = {}): ICommandModule {
  return {
    name: 'agent-command-git',
    commandSources: [new GitCommandSource()],
    systemCommands: [createGitSystemCommand(options.port ?? createGitProcess())],
  };
}
