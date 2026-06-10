import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ITerminalOutput } from '@robota-sdk/agent-core';
import { userPaths } from '@robota-sdk/agent-framework';

import { AGENT_CLI_BIN } from '../constants.js';

export function isFirstRun(markerPath: string = userPaths().onboarded): boolean {
  return !existsSync(markerPath);
}

export function markOnboarded(markerPath: string = userPaths().onboarded): void {
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, new Date().toISOString());
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

export function printFirstRunWelcome(terminal: ITerminalOutput): void {
  terminal.writeLine(WELCOME_MESSAGE);
}
