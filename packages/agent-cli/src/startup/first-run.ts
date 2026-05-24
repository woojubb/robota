import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { userPaths } from '@robota-sdk/agent-framework';

import { AGENT_CLI_BIN } from '../constants.js';

const ONBOARDED_MARKER = userPaths().onboarded;

export function isFirstRun(): boolean {
  return !existsSync(ONBOARDED_MARKER);
}

export function markOnboarded(): void {
  mkdirSync(dirname(ONBOARDED_MARKER), { recursive: true });
  writeFileSync(ONBOARDED_MARKER, new Date().toISOString());
}

const WELCOME_MESSAGE = `
╭─────────────────────────────────────────────────────────────╮
│  Welcome to ${AGENT_CLI_BIN}!  — AI coding assistant             │
│                                                             │
│  Try asking:                                                │
│    "Explain this project structure"                         │
│    "Find files with TODO comments"                          │
│    "Run tests and analyze failures"                         │
│    "What changed recently in git?"                          │
│                                                             │
│  Useful commands:                                           │
│    /help      show all slash commands                       │
│    /cost      show token usage and estimated cost           │
│    /clear     clear conversation history                    │
│                                                             │
│  ${AGENT_CLI_BIN} diagnose   — check your setup                  │
╰─────────────────────────────────────────────────────────────╯
`;

export function printFirstRunWelcome(): void {
  process.stderr.write(WELCOME_MESSAGE + '\n');
}
