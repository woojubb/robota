import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { inspectSkillSources } from '../skill-source.js';
import { createNodeHostContributionSource } from '../../contributions/node-host-contribution-source.js';
import {
  createTestSkillCommandSource,
  TEST_SKILL_ROOTS,
} from '../../testing/contribution-source-fixture.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('inspectSkillSources (OBSERVABILITY-1991 TC-05)', () => {
  it('reports discovered skills and the entries discovery silently skips, per root', () => {
    const home = mkdtempSync(join(tmpdir(), 'robota-skill-inspection-'));
    roots.push(home);
    const skills = join(home, '.robota', 'skills');
    mkdirSync(join(skills, 'good'), { recursive: true });
    writeFileSync(join(skills, 'good', 'SKILL.md'), '---\nname: good\n---\nbody\n', 'utf8');
    mkdirSync(join(skills, 'no-file'), { recursive: true });
    mkdirSync(join(skills, 'no-frontmatter'), { recursive: true });
    writeFileSync(join(skills, 'no-frontmatter', 'SKILL.md'), 'just text\n', 'utf8');
    mkdirSync(join(skills, 'open-frontmatter'), { recursive: true });
    writeFileSync(join(skills, 'open-frontmatter', 'SKILL.md'), '---\nname: x\nbody\n', 'utf8');

    const inspection = inspectSkillSources(
      [createNodeHostContributionSource(home)],
      TEST_SKILL_ROOTS,
    );
    const robota = inspection.roots.find((root) => root.root === join('.robota', 'skills'));
    expect(robota?.present).toBe(true);
    expect(robota?.discovered).toEqual(['good', 'no-frontmatter']);
    expect(robota?.skipped).toEqual([
      { path: join('.robota', 'skills', 'no-file'), reason: 'missing-skill-file' },
      {
        path: join('.robota', 'skills', 'no-frontmatter', 'SKILL.md'),
        reason: 'frontmatter-missing',
      },
      {
        path: join('.robota', 'skills', 'open-frontmatter', 'SKILL.md'),
        reason: 'frontmatter-unterminated',
        detail: expect.stringContaining('[unterminated]'),
      },
    ]);
    const absent = inspection.roots.find((root) => root.root === join('.agents', 'skills'));
    expect(absent).toEqual(
      expect.objectContaining({ present: false, discovered: [], skipped: [] }),
    );
  });

  it('reports the frontmatter value session discovery refuses, as a skip and not a discovery', () => {
    const home = mkdtempSync(join(tmpdir(), 'robota-skill-inspection-'));
    roots.push(home);
    const skills = join(home, '.robota', 'skills');
    mkdirSync(join(skills, 'bad-effort'), { recursive: true });
    writeFileSync(
      join(skills, 'bad-effort', 'SKILL.md'),
      '---\nname: bad\neffort: extreme\n---\nbody\n',
    );
    // No closing fence: the strict decoder reports the structural failure first.
    mkdirSync(join(skills, 'bad-effort-open'), { recursive: true });
    writeFileSync(
      join(skills, 'bad-effort-open', 'SKILL.md'),
      '---\nname: open\neffort: extreme\nbody\n',
    );
    const sources = [createNodeHostContributionSource(home)];

    // The premise: the session's own discovery does not register this file.
    expect(createTestSkillCommandSource(sources).getCommands()).toEqual([]);

    const robota = inspectSkillSources(sources, TEST_SKILL_ROOTS).roots.find(
      (root) => root.root === join('.robota', 'skills'),
    );
    expect(robota?.discovered).toEqual([]);
    expect(robota?.skipped).toEqual([
      {
        path: join('.robota', 'skills', 'bad-effort', 'SKILL.md'),
        reason: 'frontmatter-invalid',
        detail: expect.stringContaining('[invalid-value] effort:'),
      },
      {
        path: join('.robota', 'skills', 'bad-effort-open', 'SKILL.md'),
        reason: 'frontmatter-unterminated',
        detail: expect.stringContaining('[unterminated]'),
      },
    ]);
  });

  it('inspects host-selected non-default roots without adding framework defaults', () => {
    const home = mkdtempSync(join(tmpdir(), 'robota-skill-inspection-custom-'));
    roots.push(home);
    const customRoot = join('vendor', 'extensions');
    mkdirSync(join(home, customRoot, 'custom'), { recursive: true });
    writeFileSync(
      join(home, customRoot, 'custom', 'SKILL.md'),
      '---\nname: custom\n---\nbody\n',
      'utf8',
    );
    const descriptors = [{ root: customRoot, kind: 'skills' as const }];
    const sources = [createNodeHostContributionSource(home)];

    expect(
      createTestSkillCommandSource(sources, descriptors)
        .getCommands()
        .map((item) => item.name),
    ).toEqual(['custom']);
    expect(inspectSkillSources(sources, descriptors).roots.map((item) => item.root)).toEqual([
      customRoot,
    ]);
  });
});
