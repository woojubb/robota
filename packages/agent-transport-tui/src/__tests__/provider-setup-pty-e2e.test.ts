import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from '@homebridge/node-pty-prebuilt-multiarch';

const require = createRequire(import.meta.url);
const TSX_ESM_HOOK_PATH: string = require.resolve('tsx/esm');

const openaiDefaults = {
  model: 'gpt-4o',
  apiKey: '$ENV:OPENAI_API_KEY',
};

const DRIVER_PATH = fileURLToPath(
  new URL('./fixtures/provider-setup-prompt-driver.tsx', import.meta.url),
);
const TEST_TIMEOUT_MS = 30000;
const WAIT_TIMEOUT_MS = 15000;
const INPUT_SETTLE_MS = 75;
const OUTPUT_TAIL_LENGTH = 2000;

interface IPtyHarness {
  submit(input?: string): Promise<void>;
  waitFor(text: string): Promise<void>;
  waitForExit(): Promise<number>;
  dispose(): void;
}

const tempDirs: string[] = [];
const activeHarnesses: IPtyHarness[] = [];

afterEach(() => {
  for (const harness of activeHarnesses.splice(0)) {
    harness.dispose();
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
  const proc = pty.spawn(
    process.execPath,
    ['--import', TSX_ESM_HOOK_PATH, DRIVER_PATH, outputPath, type],
    {
      cols: 120,
      rows: 40,
      cwd: fileURLToPath(new URL('../../../../..', import.meta.url)),
      env: createPtyEnv(),
    },
  );
  const harness = createHarness(proc);
  activeHarnesses.push(harness);
  return { harness, outputPath };
}

function createHarness(proc: pty.IPty): IPtyHarness {
  let output = '';
  let exitCode: number | undefined;
  const waiters: Array<() => void> = [];

  proc.onData((data) => {
    output += data;
    notifyWaiters(waiters);
  });
  proc.onExit((event) => {
    exitCode = event.exitCode;
    notifyWaiters(waiters);
  });

  return {
    async submit(input = '') {
      await sleep(INPUT_SETTLE_MS);
      if (input) {
        proc.write(input);
        await sleep(INPUT_SETTLE_MS);
      }
      proc.write('\r');
    },
    waitFor(text: string) {
      return waitUntil(
        () => output.includes(text),
        waiters,
        () => {
          return new Error(`Timed out waiting for "${text}". Output:\n${tail(output)}`);
        },
      );
    },
    waitForExit() {
      return waitUntil(
        () => exitCode !== undefined,
        waiters,
        () => {
          return new Error(`Timed out waiting for PTY exit. Output:\n${tail(output)}`);
        },
      ).then(() => exitCode ?? -1);
    },
    dispose() {
      if (exitCode === undefined) {
        proc.kill();
      }
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

function waitUntil(
  predicate: () => boolean,
  waiters: Array<() => void>,
  createTimeoutError: () => Error,
): Promise<void> {
  if (predicate()) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const removeWaiter = (waiter: () => void): void => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) {
        waiters.splice(index, 1);
      }
    };
    const check = () => {
      if (settled) {
        return;
      }
      if (!predicate()) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      removeWaiter(check);
      resolve();
    };
    const deadline = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      removeWaiter(check);
      reject(createTimeoutError());
    }, WAIT_TIMEOUT_MS);
    waiters.push(check);
  });
}

function notifyWaiters(waiters: Array<() => void>): void {
  for (const waiter of [...waiters]) {
    waiter();
  }
}

function readResult(outputPath: string): Record<string, string | boolean> {
  expect(existsSync(outputPath)).toBe(true);
  return JSON.parse(readFileSync(outputPath, 'utf8')) as Record<string, string | boolean>;
}

function tail(output: string): string {
  return output.slice(-OUTPUT_TAIL_LENGTH);
}
