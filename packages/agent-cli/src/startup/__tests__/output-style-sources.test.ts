import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';

import { buildOutputStyleSources } from '../output-style-sources.js';

describe('CLI output-style source composition', () => {
  it('reads user styles through the host contribution source and keeps restricted projects absent', () => {
    const home = mkdtempSync(join(tmpdir(), 'robota-style-home-'));
    const cwd = mkdtempSync(join(tmpdir(), 'robota-style-cwd-'));
    const directory = join(home, '.robota', 'output-styles');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'team.md'),
      ['---', 'name: Team', 'description: Team voice', '---', 'Use team terminology.'].join('\n'),
    );

    try {
      const sources = buildOutputStyleSources({
        cwd,
        userHome: home,
        projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd),
      });

      expect(sources).toHaveLength(1);
      expect(sources[0]?.scope).toBe('user');
      expect(sources[0]?.files).toEqual([
        { fileName: 'team.md', content: expect.stringContaining('Use team terminology.') },
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
