/**
 * SEC-003 — `js/polynomial-redos` regression floor for `agent-framework`.
 *
 * Each `describe` covers one parser whose regex was quadratic. The pair is deliberate:
 *
 * - a **timing** test that pumps the string CodeQL named and asserts the parse finishes under
 *   {@link BUDGET_MS}. Every one of these ran for seconds against the pre-fix source (the numbers are in the
 *   SEC-003 backlog), so reverting a fix turns the test red on the assertion, not on a timeout.
 * - an **equivalence** test pinning the parse result for well-formed input, so the regex shape cannot be
 *   loosened back to the ambiguous form without a visible behavioural diff.
 *
 * The pumps are all reachable through the exported entry point named in each test — no private function is
 * imported, so the tests also assert that the fixed shape is the one the public path actually runs.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AgentDefinitionLoader } from '../agents/agent-definition-loader.js';
import { sanitizeProviderProfileName } from '../command-api/provider/provider-profile-names.js';
import { parseFrontmatter } from '../commands/skill-source.js';
import { parseTaskFile, readCurrentGitBranchFromNodeHost } from '../context/task-context.js';
import { ProjectMemoryStore } from '../memory/project-memory-store.js';
import { createNodeHostContributionSourcesFixture } from '../testing/contribution-source-fixture.js';
import {
  createTrustedProjectAccessFixture,
  createTrustedProjectStateFixture,
} from '../testing/trusted-project-state-fixture.js';
import { createProviderSafeModelCommandToolName } from '../tools/model-command-tool-projection.js';
import { checkForCliUpdate } from '../update-check/update-check.js';
import { getWorkspaceProjectReader } from '../workspace-trust/index.js';

/** Pump length. Every pre-fix measurement in the SEC-003 table used this size. */
const PUMP = 200_000;
/** Post-fix budget. The fixed parsers all run in single-digit milliseconds, so this is not a tight threshold. */
const BUDGET_MS = 250;
/** Generous per-test timeout so a reverted fix fails the assertion (with its elapsed time) instead of timing out. */
const RED_TIMEOUT_MS = 120_000;

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function elapsedMs(run: () => void): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

async function elapsedMsAsync(run: () => Promise<void>): Promise<number> {
  const started = performance.now();
  await run();
  return performance.now() - started;
}

describe('SEC-003 alert 41 — ProjectMemoryStore topic sanitiser', () => {
  it(
    'sanitises a pumped dash run in linear time',
    async () => {
      const root = tempDir('robota-redos-memory-');
      const store = new ProjectMemoryStore(await createTrustedProjectStateFixture(root, 'memory'));
      const topic = `x${'-'.repeat(PUMP)}y`;
      expect(elapsedMs(() => void store.readTopic(topic))).toBeLessThan(BUDGET_MS);
    },
    RED_TIMEOUT_MS,
  );

  it('keeps the sanitised topic for ordinary input', async () => {
    const dir = tempDir('robota-redos-memory-');
    const store = new ProjectMemoryStore(await createTrustedProjectStateFixture(dir, 'memory'));
    const result = store.append({ type: 'project', topic: '--Build & Env--', text: 'hello' });
    expect(result.topic).toBe('build-env');
  });
});

describe('SEC-003 alert 38 — provider profile name sanitiser', () => {
  it(
    'sanitises a pumped dash run in linear time',
    () => {
      const value = `x${'-'.repeat(PUMP)}y`;
      expect(elapsedMs(() => void sanitizeProviderProfileName(value))).toBeLessThan(BUDGET_MS);
    },
    RED_TIMEOUT_MS,
  );

  it('keeps the sanitised name for ordinary input', () => {
    expect(sanitizeProviderProfileName('  --OpenAI Chat--  ')).toBe('openai-chat');
    expect(sanitizeProviderProfileName('---')).toBeUndefined();
    expect(sanitizeProviderProfileName(undefined)).toBeUndefined();
  });
});

describe('SEC-003 alert 42 — provider-safe model command tool name', () => {
  it(
    'projects a pumped underscore run in linear time',
    () => {
      const command = `x${'_'.repeat(PUMP)}y`;
      expect(elapsedMs(() => void createProviderSafeModelCommandToolName(command))).toBeLessThan(
        BUDGET_MS,
      );
    },
    RED_TIMEOUT_MS,
  );

  it('keeps the projected tool name for ordinary input', () => {
    expect(createProviderSafeModelCommandToolName('/schedule')).toBe('robota_command_schedule');
    expect(createProviderSafeModelCommandToolName('remote-control')).toBe(
      'robota_command_remote-control',
    );
  });
});

describe('SEC-003 alert 43 — npm registry metadata URL', () => {
  it(
    'builds the URL from a pumped slash run in linear time',
    async () => {
      const registryUrl = `https://x${'/'.repeat(PUMP)}y`;
      const options = {
        currentVersion: '1.0.0',
        force: true,
        registryUrl,
        cachePath: join(tempDir('robota-redos-update-'), 'cache.json'),
        fetchImpl: (async () => ({
          ok: true,
          json: async () => ({ 'dist-tags': { latest: '9.9.9' } }),
        })) as unknown as typeof fetch,
      };
      const ms = await elapsedMsAsync(async () => void (await checkForCliUpdate(options)));
      expect(ms).toBeLessThan(BUDGET_MS);
    },
    RED_TIMEOUT_MS,
  );

  it('strips exactly the trailing slashes for ordinary input', async () => {
    const seen: string[] = [];
    await checkForCliUpdate({
      currentVersion: '1.0.0',
      force: true,
      registryUrl: 'https://registry.npmjs.org///',
      cachePath: join(tempDir('robota-redos-update-'), 'cache.json'),
      fetchImpl: (async (url: string) => {
        seen.push(url);
        return { ok: true, json: async () => ({ 'dist-tags': { latest: '9.9.9' } }) };
      }) as unknown as typeof fetch,
    });
    expect(seen).toEqual(['https://registry.npmjs.org/%40robota-sdk%2Fagent-cli']);
  });
});

describe('SEC-003 alert 39 — skill frontmatter list values', () => {
  const pumped = `---\nallowed-tools: ,x${' '.repeat(PUMP)}y,z\n---\nbody\n`;

  it(
    'parses a pumped whitespace run in linear time',
    () => {
      expect(elapsedMs(() => void parseFrontmatter(pumped))).toBeLessThan(BUDGET_MS);
    },
    RED_TIMEOUT_MS,
  );

  it('keeps the list split and trimming for ordinary input', () => {
    expect(parseFrontmatter('---\nallowed-tools: Read , Write ,,Bash\n---\n')).toEqual({
      allowedTools: ['Read', 'Write', 'Bash'],
    });
    expect(parseFrontmatter('---\nallowed-tools: Read  Write\n---\n')).toEqual({
      allowedTools: ['Read', 'Write'],
    });
  });
});

describe('SEC-003 sweep — agent definition frontmatter list values (unflagged twin of alert 39)', () => {
  function loaderFor(frontmatter: string): AgentDefinitionLoader {
    const cwd = tempDir('robota-redos-agents-');
    const dir = join(cwd, '.robota', 'agents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'probe.md'), frontmatter, 'utf8');
    return new AgentDefinitionLoader(
      createNodeHostContributionSourcesFixture(cwd, join(cwd, 'home')),
      [],
    );
  }

  it(
    'parses a pumped whitespace run in linear time',
    () => {
      const loader = loaderFor(`---\ntools: ,x${' '.repeat(PUMP)}y,z\n---\nbody\n`);
      expect(elapsedMs(() => void loader.loadAll())).toBeLessThan(BUDGET_MS);
    },
    RED_TIMEOUT_MS,
  );

  it('keeps the list split and trimming for ordinary input', () => {
    const loader = loaderFor('---\nname: probe\ntools: Read , Write ,,Bash\n---\nbody\n');
    expect(loader.loadAll()[0]?.tools).toEqual(['Read', 'Write', 'Bash']);
  });
});

describe('SEC-003 alert 40 — git worktree `gitdir:` pointer', () => {
  function repoWithGitFile(content: string): string {
    const dir = tempDir('robota-redos-gitdir-');
    writeFileSync(join(dir, '.git'), content, 'utf8');
    return dir;
  }

  it(
    'reads a pumped whitespace run in linear time',
    () => {
      const cwd = repoWithGitFile(`gitdir:${' '.repeat(PUMP)}x\ny`);
      expect(elapsedMs(() => void readCurrentGitBranchFromNodeHost(cwd))).toBeLessThan(BUDGET_MS);
    },
    RED_TIMEOUT_MS,
  );

  it('still follows a well-formed `gitdir:` pointer to the branch', () => {
    const gitDir = tempDir('robota-redos-realgit-');
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/feature/x\n', 'utf8');
    const cwd = repoWithGitFile(`gitdir: ${gitDir}\n`);
    expect(readCurrentGitBranchFromNodeHost(cwd)).toBe('feature/x');
  });
});

describe('SEC-003 sweep — task file open items (unflagged, same shape as alert 40)', () => {
  function taskFile(content: string): { path: string; cwd: string } {
    const cwd = tempDir('robota-redos-task-');
    const path = 'task.md';
    writeFileSync(join(cwd, path), content, 'utf8');
    return { path, cwd };
  }

  it(
    'parses a pumped whitespace run on a CR-only line in linear time',
    async () => {
      // A lone `\r` survives the `/\r?\n/` split, so one "line" can hold a run that never reaches `$`.
      const { path, cwd } = taskFile(`# T\n- [ ]${' '.repeat(PUMP)}x\ry\n`);
      const access = await createTrustedProjectAccessFixture(cwd);
      if (access.status !== 'trusted') throw new Error('Expected trusted project access.');
      const reader = getWorkspaceProjectReader(access.authority);
      expect(elapsedMs(() => void parseTaskFile(path, reader))).toBeLessThan(BUDGET_MS);
    },
    RED_TIMEOUT_MS,
  );

  it('keeps the open-item extraction for ordinary input', async () => {
    const { path, cwd } = taskFile('# T\n- [ ] first item\n- [x] done\n- [ ]   spaced  \n');
    const access = await createTrustedProjectAccessFixture(cwd);
    if (access.status !== 'trusted') throw new Error('Expected trusted project access.');
    expect(parseTaskFile(path, getWorkspaceProjectReader(access.authority)).openItems).toEqual([
      'first item',
      'spaced',
    ]);
  });
});
