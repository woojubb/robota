import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CommandRegistry } from '@robota-sdk/agent-framework';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { reloadPluginCommandSource } from '../../plugins/default-plugin-command-source-loader.js';
import { parseCliArgs } from '../../utils/cli-args.js';
import {
  createCliWorkspaceComposition,
  resolveStartupWorkspaceProjectAccess,
} from '../workspace-project-composition.js';

/** Issue #3082 — `--safe-mode` turns every customization off. */
let home: string;
beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'robota-safe-mode-unit-')));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('--safe-mode', () => {
  it('parses', () => {
    expect(parseCliArgs(['--safe-mode']).safeMode).toBe(true);
    expect(parseCliArgs([]).safeMode).toBe(false);
  });

  it('starts Restricted whatever the trust store says', async () => {
    const trusted = { status: 'trusted' } as never;
    const access = await resolveStartupWorkspaceProjectAccess(
      ['node', 'robota', '--safe-mode'],
      home,
      {
        projectAccess: trusted,
      },
    );
    expect(access.status).toBe('restricted');
  });

  it('composes no skill, command or agent source, the user scope included', () => {
    const normal = createCliWorkspaceComposition({ cwd: home, userHome: home });
    expect(normal.contributionSources.length).toBeGreaterThan(0);
    const safe = createCliWorkspaceComposition({ cwd: home, userHome: home, safeMode: true });
    expect(safe.contributionSources).toEqual([]);
  });

  it('loads no plugin commands', () => {
    const registry = new CommandRegistry();
    expect(reloadPluginCommandSource(registry, home, undefined, false)).toBe(0);
  });
});
