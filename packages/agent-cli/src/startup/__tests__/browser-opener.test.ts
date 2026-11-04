/**
 * The platform's browser opener hands the link to the browser and may then stay in the foreground
 * (`xdg-open` without a detected desktop environment does). So it is started and let go, in both
 * modes: the call settles once the opener has started, the opener is never ended with this process or
 * by a timeout, and an opener that cannot start rejects.
 */

import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { enableOwnChildSessions } from '@robota-sdk/agent-core/node';
import { resetChildSessionsForTesting } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openInBrowser } from '../browser-opener.js';

const POSIX = process.platform !== 'win32';
const url = new URL('https://example.test/authorize');
let bin: string;
let pidFile: string;
let originalPath: string | undefined;

beforeEach(() => {
  bin = realpathSync(mkdtempSync(join(tmpdir(), 'opener-stub-')));
  pidFile = join(bin, 'pid');
  // An opener that stays in the foreground, as `xdg-open` can.
  writeFileSync(join(bin, 'xdg-open'), `#!/bin/sh\necho $$ > ${pidFile}\nexec /bin/sleep 30\n`);
  chmodSync(join(bin, 'xdg-open'), 0o755);
  originalPath = process.env.PATH;
  process.env.PATH = bin;
});

afterEach(() => {
  resetChildSessionsForTesting();
  process.env.PATH = originalPath;
  if (existsSync(pidFile)) {
    try {
      process.kill(Number(readFileSync(pidFile, 'utf8').trim()), 'SIGKILL');
    } catch {
      // already gone
    }
  }
  rmSync(bin, { recursive: true, force: true });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function openerPid(): Promise<number> {
  const deadline = Date.now() + 5000;
  while (!existsSync(pidFile) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  return Number(readFileSync(pidFile, 'utf8').trim());
}

async function openAndMeasure(): Promise<{ ms: number; pid: number; exitListenersAdded: number }> {
  const exitListeners = process.listenerCount('exit');
  const started = Date.now();
  await openInBrowser(url, { platform: 'linux' });
  const ms = Date.now() - started;
  const exitListenersAdded = process.listenerCount('exit') - exitListeners;
  return { ms, pid: await openerPid(), exitListenersAdded };
}

describe.skipIf(!POSIX)('opening the browser', () => {
  it(
    'resolves as soon as the opener starts in plain mode, while the opener stays in the foreground',
    async () => {
      const { ms, pid } = await openAndMeasure();

      expect(ms).toBeLessThan(2000);
      expect(alive(pid)).toBe(true);
    },
    20_000,
  );

  it(
    'resolves at once in secure mode too, and the opener is neither tracked nor ended',
    async () => {
      enableOwnChildSessions();
      const { ms, pid, exitListenersAdded } = await openAndMeasure();
      await new Promise((r) => setTimeout(r, 500));

      expect(ms).toBeLessThan(2000);
      expect(exitListenersAdded).toBe(0);
      expect(alive(pid)).toBe(true);
    },
    20_000,
  );

  it('rejects when the opener cannot start (guard)', async () => {
    process.env.PATH = join(bin, 'empty');

    await expect(openInBrowser(url, { platform: 'linux' })).rejects.toThrow(
      'The browser could not be opened.',
    );
  });
});
