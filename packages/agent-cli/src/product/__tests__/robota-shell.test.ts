import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { UnsupportedShellError } from '@robota-sdk/agent-core';

import { resolveRobotaShellExecutable } from '../robota-shell.js';
import {
  createRobotaPackSet,
  createRobotaSubagentComposition,
} from '../robota-subagent-composition.js';

/** Roots sit, unmade, in one private per-run directory rather than at a fixed name under /tmp. */
const PRIVATE_BASE = mkdtempSync(join(tmpdir(), 'robota-shell-test-'));
afterAll(() => rmSync(PRIVATE_BASE, { recursive: true, force: true }));

describe('Robota shell policy', () => {
  it('selects a validated explicit executable from ROBOTA_SHELL', () => {
    expect(resolveRobotaShellExecutable({ ROBOTA_SHELL: '  /bin/bash  ' })).toBe('/bin/bash');
    expect(resolveRobotaShellExecutable({ ROBOTA_SHELL: '   ' })).toBeUndefined();
  });

  it('fails closed for an unsupported override', () => {
    expect(() => resolveRobotaShellExecutable({ ROBOTA_SHELL: '/bin/fish' })).toThrow(
      UnsupportedShellError,
    );
  });

  it('passes the choice through the parent coding pack', () => {
    const shellExecutable = resolveRobotaShellExecutable({ ROBOTA_SHELL: '/bin/bash' });
    const { packs } = createRobotaPackSet(join(PRIVATE_BASE, 'parent'), { shellExecutable });
    const shell = packs
      .flatMap((pack) => pack.tools ?? [])
      .find((tool) => tool.getName() === 'Shell');
    expect(shell?.getDescription()).toContain('bash on');
  });

  it('rebuilds the child tool and hook choices from Robota policy', () => {
    const previous = process.env['ROBOTA_SHELL'];
    process.env['ROBOTA_SHELL'] = '/bin/bash';
    try {
      const composition = createRobotaSubagentComposition();
      const shell = composition
        .createTools({ cwd: join(PRIVATE_BASE, 'child') })
        .find((tool) => tool.getName() === 'Shell');
      expect(shell?.getDescription()).toContain('bash on');
      expect(composition.createHookTypeExecutors?.().map((executor) => executor.type)).toEqual([
        'command',
        'http',
      ]);
    } finally {
      if (previous === undefined) delete process.env['ROBOTA_SHELL'];
      else process.env['ROBOTA_SHELL'] = previous;
    }
  });
});
