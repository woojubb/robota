/**
 * INFRA-020 TC-04: cross-fidelity proof that `IAgentDriver` is a real contract.
 *
 * The SAME scenario (`runScenario`) is written once against the `IAgentDriver` interface and run on
 * two independent implementers:
 *   - the in-process programmatic driver (`createProgrammaticAgent`, scripted provider), and
 *   - the built-binary driver (`createBinaryAgentDriver`, the real robota CLI in print/stream-json mode
 *     made deterministic by `--session-log`).
 * Both must observe the identical reply — proving the client-side contract holds across fidelities.
 *
 * Build-gated (`*.bintest.ts`, `test:bin` project): requires `pnpm --filter @robota-sdk/agent-cli build`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { createProgrammaticAgent } from '@robota-sdk/agent-transport/programmatic';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createBinaryAgentDriver } from '../../testing/binary-agent-driver.js';

import type { IAgentDriver } from '@robota-sdk/agent-interface-transport';

const ANSWER = 'CROSS_FIDELITY_OK';
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cross-fidelity.jsonl');

/** One scenario, written against the contract — driver-agnostic. */
async function runScenario(driver: IAgentDriver): Promise<string | undefined> {
  await driver.start();
  await driver.send('hello');
  const last = driver.lastAssistantText();
  await driver.stop();
  return last;
}

function writeProviderSettings(projectDir: string): void {
  const dir = join(projectDir, '.robota');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      currentProvider: 'anthropic',
      providers: {
        // Boots the CLI; --session-log swaps in the replay provider so the key is never used.
        anthropic: { type: 'anthropic', model: 'claude-test-model', apiKey: 'bin-dummy-key' },
      },
    }),
    'utf8',
  );
}

describe('IAgentDriver cross-fidelity (INFRA-020 TC-04)', () => {
  let progCwd: string;
  let binCwd: string;
  let homeDir: string;

  beforeEach(() => {
    progCwd = mkdtempSync(join(tmpdir(), 'robota-xf-prog-'));
    binCwd = mkdtempSync(join(tmpdir(), 'robota-xf-bin-'));
    homeDir = mkdtempSync(join(tmpdir(), 'robota-xf-home-'));
    writeProviderSettings(binCwd);
  });

  afterEach(() => {
    for (const d of [progCwd, binCwd, homeDir]) rmSync(d, { recursive: true, force: true });
  });

  it('the same scenario observes the recorded reply via the programmatic AND binary drivers', async () => {
    // In-process implementer.
    const scripted = createScriptedProvider([{ text: ANSWER }]);
    const programmatic = createProgrammaticAgent({ provider: scripted.provider, cwd: progCwd });
    const programmaticReply = await runScenario(programmatic);

    // Built-binary implementer (deterministic via --session-log).
    const binary = createBinaryAgentDriver({
      cwd: binCwd,
      sessionLog: FIXTURE,
      env: { PATH: process.env['PATH'] ?? '', HOME: homeDir },
    });
    const binaryReply = await runScenario(binary);

    expect(programmaticReply).toBe(ANSWER);
    expect(binaryReply).toBe(ANSWER);
    // The contract holds across fidelities: identical observation in-process and on the real binary.
    expect(binaryReply).toBe(programmaticReply);
  });
});
