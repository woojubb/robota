import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { inspectSkillSources } from '../skill-source.js';
import { createNodeHostContributionSource } from '../../contributions/node-host-contribution-source.js';

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

    const inspection = inspectSkillSources([createNodeHostContributionSource(home)]);
    const robota = inspection.roots.find((root) => root.root === join('.robota', 'skills'));
    expect(robota?.present).toBe(true);
    expect(robota?.discovered).toEqual(['good', 'no-frontmatter', 'open-frontmatter']);
    expect(robota?.skipped).toEqual([
      { path: join('.robota', 'skills', 'no-file'), reason: 'missing-skill-file' },
      {
        path: join('.robota', 'skills', 'no-frontmatter', 'SKILL.md'),
        reason: 'frontmatter-missing',
      },
      {
        path: join('.robota', 'skills', 'open-frontmatter', 'SKILL.md'),
        reason: 'frontmatter-unterminated',
      },
    ]);
    const absent = inspection.roots.find((root) => root.root === join('.agents', 'skills'));
    expect(absent).toEqual(
      expect.objectContaining({ present: false, discovered: [], skipped: [] }),
    );
  });
});
