/**
 * CLI-067: diagnose agrees with runtime provider resolution, validates both
 * settings levels independently, and returns an issue count for the 0/1 exit
 * contract. Fixtures use an isolated HOME + temp cwd; env keys are injected.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runDiagnoseCommand } from '../diagnose-command.js';
import { createCapturingTerminal } from './test-terminal.js';

import type { IDiagnosticCheck } from '../diagnose-command.js';

const stubNetworkCheck = (): Promise<IDiagnosticCheck> =>
  Promise.resolve({ label: 'Network (stub)', status: 'ok', message: 'reachable (1ms)' });

const TEST_KEY = 'sk-diagnose-test-key-0042';

describe('diagnose accuracy (CLI-067)', () => {
  let home: string;
  let cwd: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'robota-067-home-'));
    cwd = mkdtempSync(join(tmpdir(), 'robota-067-cwd-'));
    vi.stubEnv('HOME', home);
    // No ambient provider keys leak into the checks.
    for (const name of [
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'GEMINI_API_KEY',
      'DEEPSEEK_API_KEY',
      'DASHSCOPE_API_KEY',
    ]) {
      vi.stubEnv(name, '');
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  function writeSettings(dir: string, content: string): void {
    mkdirSync(join(dir, '.robota'), { recursive: true });
    writeFileSync(join(dir, '.robota', 'settings.json'), content);
  }

  async function diagnose(): Promise<{ output: string; failCount: number }> {
    const { terminal, lines } = createCapturingTerminal();
    const failCount = await runDiagnoseCommand(
      { version: '3.0.0-test', terminal, cwd },
      { checkNetwork: stubNetworkCheck },
    );
    return { output: lines.join('\n'), failCount };
  }

  it('TC-01: profile with a resolvable $ENV reference passes the API key check', async () => {
    vi.stubEnv('MY_CUSTOM_KEY_VAR', TEST_KEY);
    writeSettings(
      cwd,
      JSON.stringify({
        currentProvider: 'anthropic',
        providers: {
          anthropic: { type: 'anthropic', model: 'claude-test', apiKey: '$ENV:MY_CUSTOM_KEY_VAR' },
        },
      }),
    );

    const { output, failCount } = await diagnose();
    expect(output).toMatch(/✓ API key: .*settings profile/);
    expect(output).toContain('anthropic');
    expect(failCount).toBe(0);
  });

  it('TC-02: no profile + recognized env key resolves via env-default (CLI-066 agreement)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', TEST_KEY);

    const { output, failCount } = await diagnose();
    expect(output).toMatch(/✓ API key: .*env-default via ANTHROPIC_API_KEY/);
    expect(failCount).toBe(0);
  });

  it('TC-03: no profile + no env key fails with the runtime guidance and counts an issue', async () => {
    const { output, failCount } = await diagnose();
    expect(output).toMatch(/✗ API key: /);
    expect(output).toContain('No provider configuration found');
    expect(failCount).toBeGreaterThan(0);
  });

  it('TC-04: corrupt user-level settings is flagged with its path even when the project file is valid', async () => {
    writeSettings(home, '{ broken');
    vi.stubEnv('MY_CUSTOM_KEY_VAR', TEST_KEY);
    writeSettings(
      cwd,
      JSON.stringify({
        currentProvider: 'anthropic',
        providers: {
          anthropic: { type: 'anthropic', model: 'claude-test', apiKey: '$ENV:MY_CUSTOM_KEY_VAR' },
        },
      }),
    );

    const { output, failCount } = await diagnose();
    expect(output).toContain(`${join(home, '.robota', 'settings.json')} — invalid JSON`);
    expect(output).toContain(`✓ Settings file: ${join(cwd, '.robota', 'settings.json')}`);
    expect(failCount).toBeGreaterThan(0);
  });

  it('TC-05: issue count drives the exit contract — 0 when clean, >0 when any check fails', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', TEST_KEY);
    const clean = await diagnose();
    expect(clean.failCount).toBe(0);

    writeSettings(home, '{ broken');
    const broken = await diagnose();
    expect(broken.failCount).toBeGreaterThan(0);
  });

  it('TC-06: the key value never appears anywhere in diagnose output', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', TEST_KEY);
    writeSettings(
      cwd,
      JSON.stringify({
        currentProvider: 'anthropic',
        providers: {
          anthropic: { type: 'anthropic', model: 'claude-test', apiKey: TEST_KEY },
        },
      }),
    );

    const { output } = await diagnose();
    expect(output).not.toContain(TEST_KEY);
  });
});
