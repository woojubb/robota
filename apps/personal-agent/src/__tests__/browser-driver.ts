/**
 * A real Chromium for tests that drive the web GUI. Playwright is resolved from the machine (it is a
 * test-only tool, not an app dependency); a machine without it skips the browser tests.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

export interface IBrowserLauncher {
  launch(): Promise<{
    newPage(): Promise<import('./browser-driver-types.js').IPage>;
    close(): Promise<void>;
  }>;
}

const CANDIDATE_REQUIRE_ROOTS = [process.cwd() + '/', '/opt/'];
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';

export function findChromium(): IBrowserLauncher | undefined {
  for (const root of CANDIDATE_REQUIRE_ROOTS) {
    try {
      const { chromium } = createRequire(root)('playwright') as {
        chromium: { executablePath(): string; launch(options?: { executablePath?: string }): Promise<never> };
      };
      // Playwright can resolve without any browser downloaded (as on CI); only a binary that exists counts.
      const executablePath = existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : chromium.executablePath();
      if (!existsSync(executablePath)) return undefined;
      return { launch: () => chromium.launch({ executablePath }) };
    } catch {
      // Try the next root.
    }
  }
  return undefined;
}
