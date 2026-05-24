import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { promptInput } from '@robota-sdk/agent-transport/headless';

import type { ITerminalOutput } from '@robota-sdk/agent-core';

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

function readClaudeSettings(claudeDir: string): Record<string, unknown> | null {
  const settingsPath = join(claudeDir, 'settings.json');
  if (!existsSync(settingsPath)) return {};
  const raw = readFileSync(settingsPath, 'utf8');
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // allow-fallback: malformed settings.json is non-fatal — null signals caller to show warning and skip migration
    return null;
  }
}

async function askYesNo(question: string): Promise<boolean> {
  const answer = await promptInput(`${question} [y/N] `);
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

export interface IInitCommandOptions {
  /** Skip all Y/n prompts and use defaults (non-interactive mode). */
  yes?: boolean;
  /** Called after init completes when the user accepts the provider setup prompt. */
  onProviderSetup?: () => Promise<void>;
}

export async function runInitCommand(
  cwd: string,
  terminal: ITerminalOutput,
  options: IInitCommandOptions = {},
): Promise<void> {
  terminal.writeLine('');
  terminal.writeLine('Robota project initialization');
  terminal.writeLine('─'.repeat(40));

  const robotaDir = join(cwd, '.robota');
  const settingsPath = join(robotaDir, 'settings.json');
  const agentsMdPath = join(cwd, 'AGENTS.md');
  const claudeDir = join(cwd, '.claude');
  const hasClaudeDir = existsSync(claudeDir);

  const hasSettings = existsSync(settingsPath);
  const hasAgentsMd = existsSync(agentsMdPath);

  if (hasSettings && hasAgentsMd) {
    terminal.writeLine('');
    terminal.writeLine('Both AGENTS.md and .robota/settings.json already exist.');
    const overwrite = await askYesNo('Overwrite existing files?');
    if (!overwrite) {
      terminal.writeLine('Init cancelled.');
      return;
    }
  }

  let settingsData: Record<string, unknown> = { ...SETTINGS_TEMPLATE };

  if (hasClaudeDir) {
    terminal.writeLine('');
    terminal.writeLine('Detected .claude/ directory (Claude Code configuration).');
    const migrate = await askYesNo('Migrate Claude Code settings to .robota/?');
    if (migrate) {
      const claudeSettings = readClaudeSettings(claudeDir);
      if (claudeSettings === null) {
        terminal.writeLine(
          'Warning: .claude/settings.json could not be parsed — skipping migration.',
        );
      } else {
        const claudePerms = claudeSettings.permissions as
          | { allow?: string[]; deny?: string[] }
          | undefined;
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

  mkdirSync(robotaDir, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settingsData, null, 2) + '\n', 'utf8');
  terminal.writeLine('');
  terminal.writeLine('Created: .robota/settings.json');

  writeFileSync(agentsMdPath, AGENTS_MD_TEMPLATE, 'utf8');
  terminal.writeLine('Created: AGENTS.md');

  terminal.writeLine('');
  terminal.writeLine('Initialization complete.');
  terminal.writeLine('');
  terminal.writeLine('Next steps:');
  terminal.writeLine('  1. Edit AGENTS.md to describe your project conventions');
  terminal.writeLine('  2. Run `robota --configure` to set up your AI provider');
  terminal.writeLine('  3. Run `robota` to start the assistant');
  terminal.writeLine('');

  const isCI = process.env['CI'] === 'true';
  if (!isCI && !options.yes && options.onProviderSetup !== undefined) {
    const setupNow = await askYesNo('Would you like to set up a provider now?');
    if (setupNow) {
      await options.onProviderSetup();
    }
  }
}
