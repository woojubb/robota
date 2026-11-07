import { describe, expect, it } from 'vitest';

import { joinPath } from '@robota-sdk/agent-core';

import { AgentDefinitionLoader } from '../agents/agent-definition-loader.js';
import { inspectSkillSources, SkillCommandSource } from '../commands/skill-source.js';
import { assertRootRelative, joinRootRelative } from './root-relative-path.js';

import type { IContributionSource } from './contribution-source.js';
import type { TWorkspaceContributionKind } from '../workspace-trust/index.js';

/**
 * A Windows host builds its layout roots with `node:path`, so they reach the framework as
 * `.claude\skills`. Readers take either separator; every label built from such a root must come out
 * in one spelling, never `.claude\skills/x/SKILL.md`.
 */
function sourceOf(
  files: Readonly<Record<string, string>>,
  displayName: string,
  workspaceRoot?: string,
): IContributionSource {
  const slashed = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '');
  const kindOf = (path: string): TWorkspaceContributionKind | undefined => {
    const wanted = slashed(path);
    if (wanted in files) return 'file';
    return Object.keys(files).some((name) => name.startsWith(`${wanted}/`))
      ? 'directory'
      : undefined;
  };
  return {
    kind: 'project',
    displayName,
    readText: (path) => files[slashed(path)],
    inspectKind: (path) => kindOf(path),
    listDirectory: (path) => {
      const prefix = `${slashed(path)}/`;
      const names = new Set(
        Object.keys(files)
          .filter((name) => name.startsWith(prefix))
          .map((name) => name.slice(prefix.length).split('/')[0]!),
      );
      return [...names].map((name) => ({ name, kind: kindOf(`${prefix}${name}`)! }));
    },
    ...(workspaceRoot === undefined
      ? {}
      : {
          locate: (relativePath: string) => {
            assertRootRelative(relativePath);
            return joinPath(workspaceRoot, relativePath);
          },
        }),
  };
}

const AGENT = '---\nname: reviewer\ndescription: Reviews\n---\nBe careful.';
const SKILL = '---\nname: audit\ndescription: Audit\n---\nbody';

describe('agent definitions under a Windows-spelled root', () => {
  it('labels a project definition with one separator', () => {
    const source = sourceOf(
      { '.robota/agents/reviewer.md': AGENT },
      'authorized workspace project',
    );
    const [agent] = new AgentDefinitionLoader([source], [], ['.robota\\agents']).loadAll();
    expect(agent?.definedIn).toBe('authorized workspace project/.robota/agents/reviewer.md');
  });

  it("labels a definition read from a Windows host directory with that directory's separator", () => {
    const source = sourceOf({ 'agents/reviewer.md': AGENT }, 'C:\\Users\\me\\.robota');
    const [agent] = new AgentDefinitionLoader([source], [], ['agents']).loadAll();
    expect(agent?.definedIn).toBe('C:\\Users\\me\\.robota\\agents\\reviewer.md');
  });

  it('reads the same definition from a POSIX-spelled root', () => {
    const source = sourceOf(
      { '.robota/agents/reviewer.md': AGENT },
      'authorized workspace project',
    );
    const [agent] = new AgentDefinitionLoader([source], [], ['.robota/agents']).loadAll();
    expect(agent?.definedIn).toBe('authorized workspace project/.robota/agents/reviewer.md');
  });
});

describe('skills under Windows-spelled roots', () => {
  const files = {
    '.claude/skills/audit/SKILL.md': SKILL,
    '.claude/skills/orphan/notes.txt': 'no skill file',
    '.claude/commands/ship.md': '---\nname: ship\ndescription: Ship\n---\nbody',
  };
  const roots = [
    { root: '.claude\\skills', kind: 'skills' as const },
    { root: '.claude\\commands', kind: 'commands' as const },
  ];

  it('finds the skills and commands and locates them under the workspace in one spelling', () => {
    const source = sourceOf(files, 'authorized workspace project', 'C:\\work\\app');
    const commands = new SkillCommandSource([source], roots).getCommands();
    expect(commands.map((command) => [command.name, command.skillDirectory])).toEqual([
      ['audit', 'C:\\work\\app\\.claude\\skills\\audit'],
      ['ship', 'C:\\work\\app\\.claude\\commands'],
    ]);
  });

  it('reports what discovery skips with one separator, and the root as the host spelled it', () => {
    const inspection = inspectSkillSources(
      [sourceOf(files, 'authorized workspace project')],
      roots,
    );
    const [skills] = inspection.roots;
    expect(skills?.root).toBe('.claude\\skills');
    expect(skills?.discovered).toEqual(['audit']);
    expect(skills?.skipped).toEqual([
      { path: '.claude/skills/orphan', reason: 'missing-skill-file' },
    ]);
    expect(inspection.roots[1]?.discovered).toEqual(['ship']);
  });
});

describe('joinRootRelative', () => {
  it.each([
    [['.claude\\skills', 'x', 'SKILL.md'], '.claude/skills/x/SKILL.md'],
    [['.claude/skills', 'x'], '.claude/skills/x'],
    [['.claude\\skills/', 'x'], '.claude/skills/x'],
    [['', 'a'], 'a'],
    [['a'], 'a'],
  ])('joins %j as %j', (segments, expected) => {
    const [root, ...names] = segments;
    expect(joinRootRelative(root!, ...names)).toBe(expected);
  });

  // A name read from a directory is data. It is not split on `\`, so `..\..\x` stays one segment
  // for the reader to refuse instead of collapsing into a path above the root.
  it.each([
    [['.robota/agents', '..\\..\\evil.md'], '.robota/agents/..\\..\\evil.md'],
    [['.robota\\agents', '..\\..\\evil.md'], '.robota/agents/..\\..\\evil.md'],
    [
      ['.robota/skills', '..\\..\\elsewhere', 'SKILL.md'],
      '.robota/skills/..\\..\\elsewhere/SKILL.md',
    ],
    [['.robota\\agents', 'a\\b.md'], '.robota/agents/a\\b.md'],
  ])('leaves the entry names of %j as they are: %j', (segments, expected) => {
    const [root, ...names] = segments;
    expect(joinRootRelative(root!, ...names)).toBe(expected);
  });

  // A rooted root is not made relative: it stays rooted for the refusal that follows.
  it.each([
    [['/abs/agents', 'x.md'], '/abs/agents/x.md'],
    [['/abs/we\\ird', 'x.md'], '/abs/we\\ird/x.md'],
    [['\\\\srv\\share', 'x'], '\\\\srv\\share\\x'],
    [['C:\\proj\\agents', 'x.md'], 'C:\\proj\\agents\\x.md'],
  ])('keeps the rooted root of %j rooted: %j', (segments, expected) => {
    const [root, ...names] = segments;
    expect(joinRootRelative(root!, ...names)).toBe(expected);
  });
});
