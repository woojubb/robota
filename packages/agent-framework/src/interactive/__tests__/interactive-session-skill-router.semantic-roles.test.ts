import { mkdirSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { SessionSkillRouter } from '../interactive-session-skill-router.js';
import { stubSubmit } from './helpers/session-stub.js';
import { createNodeHostContributionSourcesFixture } from '../../testing/contribution-source-fixture.js';

import type { ICommandHostContext, ICommandModule, ISystemCommand } from '../../commands/index.js';
import { createTestCommandHost } from '../../testing/command-host-double.js';

function makeRouter(cwd: string, command: ISystemCommand): SessionSkillRouter {
  const module: ICommandModule = { name: 'semantic-role-test', systemCommands: [command] };
  return new SessionSkillRouter(
    [module],
    createNodeHostContributionSourcesFixture(cwd),
    undefined,
    () => createTestCommandHost(),
    () => 'session-id',
    stubSubmit,
    async () => {},
    () => {},
    async () => '',
    async () => ({}) as never,
    (execute) => execute(),
  );
}

function withSkill(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-semantic-skill-')));
  const directory = join(cwd, '.agents', 'skills', 'audit');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'SKILL.md'),
    ['---', 'name: audit', 'description: Audit code', '---', 'Audit'].join('\n'),
    'utf8',
  );
  return run(cwd).finally(() => rmSync(cwd, { recursive: true, force: true }));
}

describe('SessionSkillRouter semantic roles', () => {
  it('routes virtual skills through an alternate skillActivation id and preserves an empty result', () =>
    withSkill(async (cwd) => {
      const execute = vi.fn().mockResolvedValue({ success: true, message: '' });
      const router = makeRouter(cwd, {
        name: 'activate-skill-alt',
        semanticRole: 'skillActivation',
        description: 'Activate skill',
        execute,
      });

      await expect(router.executeCommand('audit', 'src/index.ts')).resolves.toEqual({
        success: true,
        message: '',
      });
      expect(execute).toHaveBeenCalledWith(expect.anything(), 'audit src/index.ts');
    }));

  it('does not infer skill activation from the coincidental unannotated skills id', () =>
    withSkill(async (cwd) => {
      const execute = vi.fn();
      const router = makeRouter(cwd, {
        name: 'skills',
        description: 'Coincidental name',
        execute,
      });

      await expect(router.executeCommand('audit', '')).resolves.toBeNull();
      expect(execute).not.toHaveBeenCalled();
    }));
});
