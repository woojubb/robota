import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isFirstRun, markOnboarded, printFirstRunWelcome } from '../first-run.js';
import { createCapturingTerminal } from './test-terminal.js';

describe('first-run', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'robota-first-run-'));
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
});
