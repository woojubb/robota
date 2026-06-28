import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnPtyFixture } from '@robota-sdk/agent-testing';

import type { IPtyRunSession } from '@robota-sdk/agent-testing';

const openaiDefaults = {
  model: 'gpt-4o',
  apiKey: '$ENV:OPENAI_API_KEY',
};

const DRIVER_PATH = fileURLToPath(
  new URL('./fixtures/provider-setup-prompt-driver.tsx', import.meta.url),
);
const REPO_ROOT = fileURLToPath(new URL('../../../../..', import.meta.url));
const TEST_TIMEOUT_MS = 30000;
const WAIT_TIMEOUT_MS = 15000;
const INPUT_SETTLE_MS = 75;

interface IPtyHarness {
  submit(input?: string): Promise<void>;
  waitFor(text: string): Promise<void>;
  waitForExit(): Promise<number>;
  dispose(): void;
}

const tempDirs: string[] = [];
const activeSessions: IPtyRunSession[] = [];

afterEach(() => {
  for (const session of activeSessions.splice(0)) {
    session.dispose();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('provider setup interaction PTY E2E', () => {
  it(
    'submits OpenAI values through a real pseudo terminal',
    async () => {
      const { harness, outputPath } = spawnProviderSetupDriver('openai');

      await harness.waitFor('OpenAI model');
      await harness.waitFor('https://platform.openai.com/api-keys');
      await harness.submit(openaiDefaults.model);
      await harness.waitFor('OpenAI API key');
      await harness.submit();

      expect(await harness.waitForExit()).toBe(0);
      harness.dispose();
      expect(readResult(outputPath)).toEqual({
        profile: 'openai',
        type: 'openai',
        model: openaiDefaults.model,
        apiKey: openaiDefaults.apiKey,
        setCurrent: true,
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'submits Anthropic values typed through a real pseudo terminal',
    async () => {
      const { harness, outputPath } = spawnProviderSetupDriver('anthropic');

      await harness.waitFor('Anthropic API key');
      await harness.submit('sk-test');
      await harness.waitFor('Anthropic model');
      await harness.submit('claude-test');

      expect(await harness.waitForExit()).toBe(0);
      harness.dispose();
      expect(readResult(outputPath)).toEqual({
        profile: 'anthropic',
        type: 'anthropic',
        model: 'claude-test',
        apiKey: 'sk-test',
        setCurrent: true,
      });
    },
    TEST_TIMEOUT_MS,
  );
});

function spawnProviderSetupDriver(type: 'openai' | 'anthropic'): {
  harness: IPtyHarness;
  outputPath: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'robota-provider-pty-'));
  tempDirs.push(dir);
  const outputPath = join(dir, 'result.json');
  const session = spawnPtyFixture(DRIVER_PATH, {
    argv: [outputPath, type],
    cwd: REPO_ROOT,
    env: createPtyEnv(),
    cols: 120,
    rows: 40,
  });
  activeSessions.push(session);
  return { harness: createHarness(session), outputPath };
}

function createHarness(session: IPtyRunSession): IPtyHarness {
  return {
    async submit(input = '') {
      await sleep(INPUT_SETTLE_MS);
      if (input) {
        session.write(input);
        await sleep(INPUT_SETTLE_MS);
      }
      session.write('\r');
    },
    waitFor(text: string) {
      return session.waitFor(text, WAIT_TIMEOUT_MS);
    },
    waitForExit() {
      return session.expectExit(WAIT_TIMEOUT_MS);
    },
    dispose() {
      session.dispose();
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createPtyEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: '0',
    TERM: 'xterm-256color',
  };
  delete env.CI;
  return env;
}

function readResult(outputPath: string): Record<string, string | boolean> {
  expect(existsSync(outputPath)).toBe(true);
  return JSON.parse(readFileSync(outputPath, 'utf8')) as Record<string, string | boolean>;
}
