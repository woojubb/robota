import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import stringWidth from 'string-width';

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

const WELCOME_LINES = [
  `Welcome to ${AGENT_CLI_BIN}!  — AI coding assistant`,
  '',
  'Try asking:',
  '  "Explain this project structure"',
  '  "Find files with TODO comments"',
  '  "Run tests and analyze failures"',
  '  "What changed recently in git?"',
  '',
  'Useful commands:',
  '  /help      show all slash commands',
  '  /cost      show token usage and estimated cost',
  '  /clear     clear conversation history',
  '',
  `${AGENT_CLI_BIN} diagnose   — check your setup`,
];

/** Horizontal padding between the box border and the text on each side. */
const BOX_PADDING = 2;

/**
 * Frame the welcome text in a box sized from the text itself.
 *
 * The padding is computed, never hand-typed: the previous hardcoded box was drawn for a longer binary
 * name, so every line carrying the interpolated name came out short and the right border sat five
 * columns adrift — visible to every first-run user, and in the README demo recording. Widths come from
 * `string-width`, so an em dash or a CJK character in the copy still lands the border in one column.
 */
function drawBox(lines: readonly string[]): string {
  const inner = Math.max(...lines.map((line) => stringWidth(line))) + BOX_PADDING * 2;
  const body = lines.map((line) => {
    const trailing = inner - BOX_PADDING - stringWidth(line);
    return `│${' '.repeat(BOX_PADDING)}${line}${' '.repeat(trailing)}│`;
  });
  return [`╭${'─'.repeat(inner)}╮`, ...body, `╰${'─'.repeat(inner)}╯`].join('\n');
}

const WELCOME_MESSAGE = `\n${drawBox(WELCOME_LINES)}\n`;

export function printFirstRunWelcome(terminal: ITerminalOutput): void {
  terminal.writeLine(WELCOME_MESSAGE);
}
