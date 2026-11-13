import { createInventoryRuntime as createTestProductRuntime } from './product-runtime.js';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runPreparsedCliCommand } from '../../startup/preparsed-command-routing.js';
import { approveTestWorkspace } from '../../__tests__/helpers/approve-test-workspace.js';
import { launchSupervisedSession } from '../supervised-session-launch.js';

vi.mock('../supervised-session-launch.js', () => ({ launchSupervisedSession: vi.fn() }));

/** Runs `session start --background` against the given telemetry settings and returns what it printed. */
async function refusedSessionStart(telemetry: Readonly<Record<string, string>>): Promise<string[]> {
  const scratch = mkdtempSync(join(tmpdir(), 'rs-telemetry-refusal-'));
  const cwd = join(scratch, 'project');
  const home = join(scratch, 'home');
  for (const directory of [cwd, home]) mkdirSync(directory);
  execFileSync('git', ['init', '--quiet', cwd]);
  const previousHome = process.env['HOME'];
  const previousExitCode = process.exitCode;
  process.env['HOME'] = home;
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    expect(await approveTestWorkspace(cwd, createTestProductRuntime())).toBe(0);
    const options = { productRuntime: createTestProductRuntime(), providerDefinitions: [] };
    const handled = await runPreparsedCliCommand(
      options,
      ['node', 'test-product', 'session', 'start', '--background'],
      cwd,
      telemetry,
    );
    expect(handled).toBe(true);
    expect(launchSupervisedSession).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    return stderr.mock.calls.map((call) => String(call[0]));
  } finally {
    if (previousHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = previousHome;
    process.exitCode = previousExitCode;
    stderr.mockRestore();
    stdout.mockRestore();
    vi.clearAllMocks();
    rmSync(scratch, { recursive: true, force: true });
  }
}

describe('supervised session start reports a real telemetry refusal', () => {
  it('fails with the specific refusal message instead of spawning a child that would exit unexplained', async () => {
    // Enabled with an OTLP trace export, but missing the required explicit protocol setting:
    // `createConfiguredNodeOtlpLiveTelemetryPort` (and the new parent-side validator) refuse this.
    const messages = await refusedSessionStart(
      Object.freeze({
        PRODUCT_TELEMETRY_ENABLED: '1',
        PRODUCT_TELEMETRY_TRACES: 'otlp',
        PRODUCT_TELEMETRY_OTLP_ENDPOINT: 'https://collector.example',
      }),
    );
    expect(messages.some((message) => message.includes('http/protobuf'))).toBe(true);
    expect(messages.some((message) => message.includes('exited before it was ready'))).toBe(false);
  });

  it("names the setting by the running product's own variable, not the canonical one", async () => {
    const messages = await refusedSessionStart(
      Object.freeze({
        PRODUCT_TELEMETRY_ENABLED: '1',
        PRODUCT_TELEMETRY_LOG_USER_PROMPTS: '1',
      }),
    );
    // The test product's prefix is TEST_PRODUCT_: only the canonical, unprefixed name must be absent.
    expect(messages.join('')).toContain(
      'Product telemetry content capture requires TEST_PRODUCT_TELEMETRY_LOGS=otlp.',
    );
    expect(messages.join('')).not.toMatch(/\bPRODUCT_TELEMETRY_/u);
  });
});
