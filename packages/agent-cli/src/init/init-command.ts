import { promptInput } from '../cli-input.js';
import {
  assertWorkspaceProjectMutationForAuthority,
  getWorkspaceProjectReader,
  WorkspaceAuthorityRequiredError,
} from '@robota-sdk/agent-framework';

import { writeRuntimeDataIgnore } from './runtime-data-ignore.js';
import { AGENT_CLI_BIN } from '../constants.js';

import type { ITerminalOutput } from '@robota-sdk/agent-core';
import type {
  IWorkspaceProjectMutation,
  IWorkspaceProjectReader,
  TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';

const AGENTS_MD_TEMPLATE = `# AGENTS.md — Project Agent Guidelines

This file guides the AI agent working in this project. Customize it for your project.

## Project Overview

<!-- Describe your project's purpose, tech stack, and key conventions -->

## Common Commands

\`\`\`bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
\`\`\`

## Coding Conventions

- Language: <!-- e.g. TypeScript strict mode -->
- Test framework: <!-- e.g. Vitest, Jest -->
- Linting: <!-- e.g. ESLint with prettier -->

## Important Notes

<!-- Anything the agent should know before making changes -->
`;

const SETTINGS_TEMPLATE = {
  permissions: {
    allow: ['Read(.robota/**)', 'Read(.claude/**)', 'Read(.agents/**)'],
    deny: [],
  },
};

function readClaudeSettings(reader: IWorkspaceProjectReader): Record<string, unknown> | null {
  const raw = reader.readText('.claude/settings.json', 'migrate Claude project settings');
  if (raw === undefined) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // allow-fallback: malformed settings.json is non-fatal — null signals caller to show warning and skip migration
    return null;
  }
}

/** A confirmation was required but stdin cannot prompt (non-TTY without --yes). */
export class InitPromptUnavailableError extends Error {
  constructor(question: string) {
    super(
      `Cannot ask "${question}" in a non-interactive shell. Re-run with --yes to accept the defaults.`,
    );
    this.name = 'InitPromptUnavailableError';
  }
}

export interface IInitCommandOptions {
  /** Initial trusted-or-restricted workspace decision. */
  projectAccess: TWorkspaceProjectAccess;
  /** Separately approved mutation capability for this exact project authority. */
  projectMutation?: IWorkspaceProjectMutation;
  /** Skip all Y/n prompts and use the documented defaults (non-interactive mode). */
  yes?: boolean;
  /** Called after init completes when the user accepts the provider setup prompt. */
  onProviderSetup?: () => Promise<void>;
  /** Test seam: prompt function (default: transport promptInput). */
  promptFn?: (question: string) => Promise<string>;
  /** Test seam: interactive stdin state (default: process.stdin.isTTY). */
  isTTY?: boolean;
  /** Test seam: CI environment detection (default: process.env.CI === 'true'). */
  ci?: boolean;
}

interface IConfirmContext {
  yes: boolean;
  ci: boolean;
  isTTY: boolean;
  promptFn: (question: string) => Promise<string>;
  terminal: ITerminalOutput;
}

/**
 * Unified Y/n confirmation: --yes/CI apply the documented default without
 * prompting; non-TTY without --yes is a hard error naming the question;
 * otherwise prompt interactively.
 */
async function confirm(
  question: string,
  defaultAnswer: boolean,
  ctx: IConfirmContext,
): Promise<boolean> {
  if (ctx.yes || ctx.ci) {
    ctx.terminal.writeLine(
      `${question} → ${defaultAnswer ? 'Y' : 'N'} (${ctx.yes ? '--yes' : 'CI'}: using default)`,
    );
    return defaultAnswer;
  }
  if (!ctx.isTTY) {
    throw new InitPromptUnavailableError(question);
  }
  const answer = await ctx.promptFn(`${question} [y/N] `);
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

export async function runInitCommand(
  terminal: ITerminalOutput,
  options: IInitCommandOptions,
): Promise<void> {
  if (options.projectAccess.status !== 'trusted') {
    throw new WorkspaceAuthorityRequiredError('Project initialization requires project access.');
  }
  if (options.projectMutation === undefined) {
    throw new WorkspaceAuthorityRequiredError(
      'Project initialization requires project mutation permission.',
    );
  }
  const reader = getWorkspaceProjectReader(options.projectAccess.authority);
  const mutation = assertWorkspaceProjectMutationForAuthority(
    options.projectMutation,
    options.projectAccess.authority,
  );

  terminal.writeLine('');
  terminal.writeLine(`${AGENT_CLI_BIN} project initialization`);
  terminal.writeLine('─'.repeat(40));

  const confirmCtx: IConfirmContext = {
    yes: options.yes === true,
    ci: options.ci ?? process.env['CI'] === 'true',
    isTTY: options.isTTY ?? process.stdin.isTTY === true,
    promptFn: options.promptFn ?? promptInput,
    terminal,
  };

  // SEC-020: BEFORE the overwrite prompt, deliberately. These rules are additive and protective —
  // the merge below never removes a line — and the path that reaches the prompt is precisely the one
  // where `.robota/` is already populated, so transcripts may already be sitting in the tree waiting
  // to be committed. Declining to overwrite AGENTS.md is not a reason to leave them exposed, and a
  // second call site for the cancel path would be one more thing to remember.
  const ignoreOutcome = writeRuntimeDataIgnore(reader, mutation);
  terminal.writeLine('');
  terminal.writeLine(
    ignoreOutcome === 'unchanged'
      ? 'Unchanged: .robota/.gitignore (already covers runtime session data)'
      : `${ignoreOutcome === 'created' ? 'Created' : 'Updated'}: .robota/.gitignore`,
  );

  const hasClaudeDir =
    reader.inspectKind('.claude', 'inspect Claude project settings') === 'directory';
  const hasSettings =
    reader.inspectKind('.robota/settings.json', 'inspect Robota project settings') === 'file';
  const hasAgentsMd = reader.inspectKind('AGENTS.md', 'inspect project instructions') === 'file';

  if (hasSettings && hasAgentsMd) {
    terminal.writeLine('');
    terminal.writeLine('Both AGENTS.md and .robota/settings.json already exist.');
    const overwrite = await confirm('Overwrite existing files?', false, confirmCtx);
    if (!overwrite) {
      terminal.writeLine('Init cancelled.');
      return;
    }
  }

  let settingsData: Record<string, unknown> = { ...SETTINGS_TEMPLATE };

  if (hasClaudeDir) {
    terminal.writeLine('');
    terminal.writeLine('Detected .claude/ directory (Claude Code configuration).');
    const migrate = await confirm('Migrate Claude Code settings to .robota/?', false, confirmCtx);
    if (migrate) {
      const claudeSettings = readClaudeSettings(reader);
      if (claudeSettings === null) {
        terminal.writeLine(
          'Warning: .claude/settings.json could not be parsed — skipping migration.',
        );
      } else {
        const claudePerms = claudeSettings.permissions as
          { allow?: string[]; deny?: string[] } | undefined;
        settingsData = {
          ...claudeSettings,
          permissions: {
            ...(typeof claudeSettings.permissions === 'object' &&
            claudeSettings.permissions !== null
              ? (claudeSettings.permissions as Record<string, unknown>)
              : {}),
            allow: [...SETTINGS_TEMPLATE.permissions.allow, ...(claudePerms?.allow ?? [])],
            deny: claudePerms?.deny ?? [],
          },
        };
        terminal.writeLine('Settings imported from .claude/settings.json.');
      }
    }
  }

  mutation.writeBytes(
    '.robota/settings.json',
    new TextEncoder().encode(`${JSON.stringify(settingsData, null, 2)}\n`),
    'initialize Robota project settings',
  );
  terminal.writeLine('');
  terminal.writeLine('Created: .robota/settings.json');

  mutation.writeBytes(
    'AGENTS.md',
    new TextEncoder().encode(AGENTS_MD_TEMPLATE),
    'initialize project instructions',
  );
  terminal.writeLine('Created: AGENTS.md');

  terminal.writeLine('');
  terminal.writeLine('Initialization complete.');
  terminal.writeLine('');
  terminal.writeLine('Next steps:');
  terminal.writeLine('  1. Edit AGENTS.md to describe your project conventions');
  terminal.writeLine(`  2. Run \`${AGENT_CLI_BIN} --configure\` to set up your AI provider`);
  terminal.writeLine(`  3. Run \`${AGENT_CLI_BIN}\` to start the assistant`);
  terminal.writeLine('');

  // Provider setup is an optional trailing step: init has already completed, so a
  // non-TTY shell skips it (default N) rather than failing a successful init.
  if (
    options.onProviderSetup !== undefined &&
    (confirmCtx.isTTY || confirmCtx.yes || confirmCtx.ci)
  ) {
    const setupNow = await confirm('Would you like to set up a provider now?', false, confirmCtx);
    if (setupNow) {
      await options.onProviderSetup();
    }
  }
}
