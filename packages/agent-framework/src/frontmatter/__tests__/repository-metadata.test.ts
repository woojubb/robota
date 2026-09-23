import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { decodeFrontmatter } from '../frontmatter-decoder.js';

import type { TFrontmatterProfile } from '../frontmatter-types.js';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../../..');
interface IMetadataFile {
  path: string;
  profile: TFrontmatterProfile;
}

function repositoryFiles(): IMetadataFile[] {
  const files: IMetadataFile[] = [];
  for (const root of ['.robota/skills', '.agents/skills', '.claude/skills']) {
    const directory = join(REPOSITORY_ROOT, root);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(root, entry.name, 'SKILL.md');
      if (existsSync(join(REPOSITORY_ROOT, path))) files.push({ path, profile: 'skill' });
    }
  }
  for (const root of ['.robota/agents', '.agents/agents', '.claude/agents', '.claude/commands']) {
    const directory = join(REPOSITORY_ROOT, root);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      files.push({
        path: join(root, entry.name),
        profile: root.endsWith('/commands') ? 'skill' : 'agent',
      });
    }
  }
  return files;
}

describe('first-party metadata remains usable through strict discovery', () => {
  const files = repositoryFiles();
  it('includes the checked-in skills and agents', () => {
    expect(files.some(({ path }) => path.startsWith('.agents/skills/'))).toBe(true);
    expect(files.some(({ path }) => path.startsWith('.claude/agents/'))).toBe(true);
  });

  it.each(files)('$path decodes without weakening the profile', ({ path, profile }) => {
    const result = decodeFrontmatter({
      source: path,
      profile,
      content: readFileSync(join(REPOSITORY_ROOT, path), 'utf8'),
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });
});
