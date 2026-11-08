/**
 * `/unlock` and `/lock` reach the command set only through the key custody the TUI was
 * given. With secure mode off there is no custody, so a plain product has neither command.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestProductRuntime } from './helpers/product-runtime.js';
import { buildCommandSetup } from '../startup/command-setup.js';

import type { IParsedCliArgs } from '../utils/cli-args.js';
import type { IKeyCustodyCommandPort } from '@robota-sdk/agent-command';

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function commandNames(keyCustodyPort?: IKeyCustodyCommandPort): string[] {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-setup-key-custody-')));
  homes.push(home);
  const { baseCommandModules } = buildCommandSetup(
    home,
    { noUpdateCheck: true } as Partial<IParsedCliArgs> as IParsedCliArgs,
    { productRuntime: createTestProductRuntime('test-product', { HOME: home }) },
    '0.0.0-test',
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    keyCustodyPort,
  );
  return baseCommandModules.flatMap((module) =>
    (module.systemCommands ?? []).map((command) => command.name),
  );
}

describe('buildCommandSetup and the key custody', () => {
  it('registers /unlock and /lock only with a custody', () => {
    expect(commandNames()).not.toContain('unlock');
    expect(commandNames()).not.toContain('lock');

    const names = commandNames({
      isUnlocked: () => false,
      unlock: async () => ({ outcome: 'unlocked', notices: [] }),
      lock: () => undefined,
    });
    expect(names).toContain('unlock');
    expect(names).toContain('lock');
  });
});
