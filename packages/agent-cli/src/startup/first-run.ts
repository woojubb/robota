import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ONBOARDED_MARKER = join(homedir(), '.robota', 'onboarded');

export function isFirstRun(): boolean {
  return !existsSync(ONBOARDED_MARKER);
}

export function markOnboarded(): void {
  const dir = join(homedir(), '.robota');
  mkdirSync(dir, { recursive: true });
  writeFileSync(ONBOARDED_MARKER, new Date().toISOString());
}

const WELCOME_MESSAGE = `
╭─────────────────────────────────────────────────────────────╮
│  Welcome to robota!  — AI coding assistant                  │
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
│  robota diagnose   — check your setup                       │
╰─────────────────────────────────────────────────────────────╯
`;

export function printFirstRunWelcome(): void {
  process.stderr.write(WELCOME_MESSAGE + '\n');
}
