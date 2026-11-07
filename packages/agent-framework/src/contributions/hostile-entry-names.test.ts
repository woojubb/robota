import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AgentDefinitionLoader } from '../agents/agent-definition-loader.js';
import { inspectSkillSources, SkillCommandSource } from '../commands/skill-source.js';
import { createTrustedProjectAccessFixture } from '../testing/trusted-project-state-fixture.js';
import { getWorkspaceProjectReader } from '../workspace-trust/index.js';
import { createWorkspaceProjectContributionSource } from './contribution-source.js';
import { createNodeHostContributionSource } from './node-host-contribution-source.js';

import type { IContributionSource } from './contribution-source.js';

const AGENT = (name: string) => `---\nname: ${name}\ndescription: ${name}\n---\nbody`;
const SKILL = (name: string) => `---\nname: ${name}\ndescription: ${name}\n---\nbody`;

const trees: string[] = [];
afterEach(() => {
  for (const tree of trees.splice(0)) rmSync(tree, { recursive: true, force: true });
});

function write(root: string, relativePath: string, content: string): void {
  const file = join(root, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function newTree(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hostile-entry-names-')));
  trees.push(root);
  write(root, '.robota/agents/good.md', AGENT('good'));
  write(root, '.robota/skills/good/SKILL.md', SKILL('good'));
  write(root, '.robota/commands/good.md', SKILL('good'));
  return root;
}

/** What each hostile name would reach if the `..` in it were collapsed before the reader saw it. */
function plantHostileEntries(root: string): void {
  write(root, '.robota/agents/..\\..\\evil.md', AGENT('evil'));
  write(root, 'evil.md', AGENT('evil'));
  write(root, '.robota/skills/..\\..\\elsewhere/SKILL.md', SKILL('elsewhere'));
  write(root, 'elsewhere/SKILL.md', SKILL('elsewhere'));
  write(root, '.robota/commands/..\\..\\cmd.md', SKILL('cmd'));
  write(root, 'cmd.md', SKILL('cmd'));
}

async function sourcesOf(root: string): Promise<Record<string, IContributionSource>> {
  const access = await createTrustedProjectAccessFixture(root);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  return {
    project: createWorkspaceProjectContributionSource(
      getWorkspaceProjectReader(access.authority),
      root,
    ),
    host: createNodeHostContributionSource(root),
  };
}

const REFUSED = /parent-directory segments/;
const SOURCES = ['project', 'host'] as const;
const LAYOUT_SPELLINGS = ['posix', 'windows'] as const;
const spell = (path: string, spelling: (typeof LAYOUT_SPELLINGS)[number]) =>
  spelling === 'windows' ? path.replaceAll('/', '\\') : path;

// A filename can hold `\` only off Windows, which is where the collapse would be a way out.
describe.skipIf(process.platform === 'win32')(
  'a directory entry that looks like a parent-directory walk',
  () => {
    describe.each(SOURCES)('read through the %s source', (kind) => {
      describe.each(LAYOUT_SPELLINGS)('under a %s-spelled layout root', (spelling) => {
        const agentRoot = spell('.robota/agents', spelling);
        const skillRoot = spell('.robota/skills', spelling);
        const commandRoot = spell('.robota/commands', spelling);

        it('loads the agents and skills of a tree without one', async () => {
          const source = (await sourcesOf(newTree()))[kind]!;
          expect(
            new AgentDefinitionLoader([source], [], [agentRoot]).loadAll().map((a) => a.name),
          ).toContain('good');
          expect(
            new SkillCommandSource([source], [{ root: skillRoot, kind: 'skills' }])
              .getCommands()
              .map((command) => command.name),
          ).toEqual(['good']);
          expect(
            new SkillCommandSource([source], [{ root: commandRoot, kind: 'commands' }])
              .getCommands()
              .map((command) => command.name),
          ).toEqual(['good']);
        });

        it('is refused by the reader, not collapsed into the agent above the root', async () => {
          const root = newTree();
          plantHostileEntries(root);
          const source = (await sourcesOf(root))[kind]!;

          expect(() => new AgentDefinitionLoader([source], [], [agentRoot]).loadAll()).toThrow(
            REFUSED,
          );
        });

        it('is refused by the reader, not collapsed into the skill above the root', async () => {
          const root = newTree();
          plantHostileEntries(root);
          const source = (await sourcesOf(root))[kind]!;

          expect(() =>
            new SkillCommandSource([source], [{ root: skillRoot, kind: 'skills' }]).getCommands(),
          ).toThrow(REFUSED);
          expect(() =>
            inspectSkillSources([source], [{ root: skillRoot, kind: 'skills' }]),
          ).toThrow(REFUSED);
        });

        it('is refused by the reader, not collapsed into the command above the root', async () => {
          const root = newTree();
          plantHostileEntries(root);
          const source = (await sourcesOf(root))[kind]!;

          expect(() =>
            new SkillCommandSource(
              [source],
              [{ root: commandRoot, kind: 'commands' }],
            ).getCommands(),
          ).toThrow(REFUSED);
          expect(() =>
            inspectSkillSources([source], [{ root: commandRoot, kind: 'commands' }]),
          ).toThrow(REFUSED);
        });
      });

      it('refuses a rooted layout root instead of reading it as relative', async () => {
        const source = (await sourcesOf(newTree()))[kind]!;

        for (const rooted of ['/abs/agents', '\\abs\\agents', 'C:\\abs\\agents']) {
          expect(() => new AgentDefinitionLoader([source], [], [rooted]).loadAll()).toThrow(
            /root-relative path/,
          );
          expect(() =>
            new SkillCommandSource([source], [{ root: rooted, kind: 'skills' }]).getCommands(),
          ).toThrow(/root-relative path/);
        }
      });
    });
  },
);
