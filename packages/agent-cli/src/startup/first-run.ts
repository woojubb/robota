import type { ICliRuntimeContext } from '../product/runtime-context.js';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import stringWidth from 'string-width';

import type { ITerminalOutput } from '@robota-sdk/agent-core';

export function isFirstRun(markerPath: string): boolean {
  return !existsSync(markerPath);
}

export function markOnboarded(markerPath: string): void {
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, new Date().toISOString());
}

function welcomeLines(runtime: ICliRuntimeContext): readonly string[] { return [
  `Welcome to ${runtime.vocabulary.cliName}!  — AI coding assistant`,
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
  `${runtime.vocabulary.cliName} diagnose   — check your setup`,
]; }

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



/**
 * CLI-2004: the same copy without the frame. The box is chrome — a screen reader announces every
 * `│` and every run of `─` before it reaches a word of the welcome, which is the first thing a
 * first-run user would hear. The content is kept; only the drawing goes.
 */


export interface IFirstRunWelcomeOptions {
  /** Screen-reader mode ⇒ the unframed form. */
  screenReader?: boolean;
}

export function printFirstRunWelcome(
  terminal: ITerminalOutput,
  runtime: ICliRuntimeContext,
  options: IFirstRunWelcomeOptions = {},
): void {
  const lines = welcomeLines(runtime);
  terminal.writeLine(`\n${options.screenReader === true ? lines.join('\n') : drawBox(lines)}\n`);
}
