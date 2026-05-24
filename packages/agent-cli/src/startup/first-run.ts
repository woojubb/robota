import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { promptInput } from '@robota-sdk/agent-transport/headless';

import { sendTelemetryEvent, setTelemetryEnabled } from './telemetry.js';

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

const TELEMETRY_PROMPT = `Help improve Robota by sharing anonymous usage data?
No file contents, paths, or personal data are ever collected.
You can change this anytime with: robota config set telemetry false

Enable anonymous telemetry? [y/N] `;

/**
 * Show a telemetry opt-in prompt during first run.
 * Saves the user's choice to ~/.robota/settings.json.
 * Fires session_start event if the user opts in.
 */
export async function promptTelemetryOptIn(): Promise<void> {
  const answer = await promptInput(TELEMETRY_PROMPT);
  const enabled = answer.trim().toLowerCase() === 'y';
  setTelemetryEnabled(enabled);
  if (enabled) {
    sendTelemetryEvent('session_start');
  }
}
