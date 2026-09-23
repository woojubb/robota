import { mkdtempSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import stringWidth from 'string-width';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isFirstRun, markOnboarded, printFirstRunWelcome } from '../first-run.js';
import { createCapturingTerminal } from './test-terminal.js';

describe('first-run', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = realpathSync(mkdtempSync(join(tmpdir(), 'robota-first-run-')));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('TC-03: isFirstRun is true without marker and false after markOnboarded', () => {
    const marker = join(tempHome, '.robota', 'onboarded');
    expect(isFirstRun(marker)).toBe(true);
    markOnboarded(marker);
    expect(isFirstRun(marker)).toBe(false);
    expect(existsSync(marker)).toBe(true);
  });

  it('TC-03: printFirstRunWelcome writes the welcome banner to the injected terminal', () => {
    const { terminal, lines } = createCapturingTerminal();
    printFirstRunWelcome(terminal);
    const output = lines.join('\n');
    expect(output).toContain('Welcome to');
    expect(output).toContain('/help');
  });

  // PM-031: the banner is the first thing a new user sees — and it is in the README demo recording.
  // The box used to be hand-drawn for a longer binary name, so the lines carrying the interpolated
  // name were five columns short and the right border stair-stepped.
  it('PM-031: every welcome-box line is exactly the same display width', () => {
    const { terminal, lines } = createCapturingTerminal();
    printFirstRunWelcome(terminal);
    const boxLines = lines
      .join('\n')
      .split('\n')
      .filter((line) => line.startsWith('╭') || line.startsWith('│') || line.startsWith('╰'));

    expect(boxLines.length).toBeGreaterThan(3);
    const widths = new Set(boxLines.map((line) => stringWidth(line)));
    expect(widths.size).toBe(1);
    for (const line of boxLines.slice(1, -1)) {
      expect(line.endsWith('│')).toBe(true);
    }
  });
});
