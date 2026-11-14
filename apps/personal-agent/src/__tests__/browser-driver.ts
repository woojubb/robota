/**
 * A real Chromium for tests that drive the web UI, found the way the agent's own browser finds one; a
 * machine without a Chromium skips the browser tests.
 */
import { chromium } from 'playwright';

import { findChromiumExecutable } from '../browser/playwright-browser.js';

import type { Browser } from 'playwright';

export interface IBrowserLauncher {
  launch(): Promise<Browser>;
}

export function findChromium(): IBrowserLauncher | undefined {
  const executablePath = findChromiumExecutable();
  if (executablePath === undefined) return undefined;
  return { launch: () => chromium.launch({ executablePath }) };
}
