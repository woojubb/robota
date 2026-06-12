/**
 * CLI-070: `--reset` is documented in help and guarded by a confirmation
 * matrix (TTY × --yes). Refusal paths leave the settings file untouched.
 */

import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { printHelp } from '../../utils/cli-args.js';
import { runResetConfig } from '../reset-config.js';
import { createCapturingTerminal } from './test-terminal.js';

describe('--reset confirmation matrix (CLI-070)', () => {
  let home: string;
  let settingsPath: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'robota-070-'));
    vi.stubEnv('HOME', home);
    settingsPath = join(home, '.robota', 'settings.json');
    mkdirSync(join(home, '.robota'), { recursive: true });
    writeFileSync(settingsPath, '{}');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it('TC-01: --help documents --reset with what it deletes and the --yes skip', () => {
    const help = printHelp();
    expect(help).toContain('--reset');
    expect(help).toContain('~/.robota/settings.json');
    expect(help).toMatch(/--reset[\s\S]*--yes/);
  });

  it('TC-02: non-TTY without --yes refuses, exits 1, file untouched', async () => {
    const { terminal, errors } = createCapturingTerminal();
    const code = await runResetConfig(terminal, { yes: false, isTTY: false });

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('--yes');
    expect(existsSync(settingsPath)).toBe(true);
  });

  it('TC-03: --yes deletes without any prompt and exits 0', async () => {
    const confirm = vi.fn(async () => true);
    const { terminal, lines } = createCapturingTerminal();
    const code = await runResetConfig(terminal, { yes: true, isTTY: false, confirm });

    expect(code).toBe(0);
    expect(confirm).not.toHaveBeenCalled();
    expect(existsSync(settingsPath)).toBe(false);
    expect(lines.join('\n')).toContain(`Deleted ${settingsPath}`);
  });

  it('TC-04: TTY prompt — n aborts with exit 1 and keeps the file; y deletes with exit 0', async () => {
    const { terminal } = createCapturingTerminal();

    const declined = await runResetConfig(terminal, {
      yes: false,
      isTTY: true,
      confirm: async () => false,
    });
    expect(declined).toBe(1);
    expect(existsSync(settingsPath)).toBe(true);

    const confirmQuestion = vi.fn(async (question: string) => {
      expect(question).toContain(settingsPath);
      return true;
    });
    const accepted = await runResetConfig(terminal, {
      yes: false,
      isTTY: true,
      confirm: confirmQuestion,
    });
    expect(accepted).toBe(0);
    expect(confirmQuestion).toHaveBeenCalledTimes(1);
    expect(existsSync(settingsPath)).toBe(false);
  });

  it('TC-05: no settings file present reports nothing to delete and exits 0', async () => {
    rmSync(settingsPath);
    const { terminal, lines } = createCapturingTerminal();
    const code = await runResetConfig(terminal, { yes: false, isTTY: false });

    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('No user settings found.');
  });
});
