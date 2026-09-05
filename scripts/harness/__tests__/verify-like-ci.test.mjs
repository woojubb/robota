// harness-coverage: dist-free-subject-identity.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { describeCiSource } from '../ci-mirror-map.mjs';
import { resolveDistFreeSubject, runWithDistFreeSubject } from '../dist-free-subject-identity.mjs';
import { ceilingIn } from '../scan-lint-ceiling-declared-vs-frozen.mjs';
import {
  advanceBuildState,
  annotateNotMirrored,
  CI_STAGES,
  classifyLocalProductChanges,
  collectChangedFiles,
  createProductStageCommands,
  findMissingDist,
  globExtensions,
  lintStagedExtensions,
  listBuildablePackageDirs,
  listNodeModulesOwners,
  NOT_MIRRORED,
  parseArgs,
  parseDistIndependentScanSkips,
  parseGitFileList,
  readDistIndependentScanSkips,
  readLintStagedExtensions,
  readsDistTypes,
  selectFormatTargets,
  stageBlockCause,
  stageGate,
  staleDistHint,
  summarize,
} from '../verify-like-ci.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

/** The whole-workspace warning ceiling as the root manifest declares it, read the same way. */
function declaredWorkspaceLintCeiling() {
  const { ceiling } = ceilingIn(readFileSync(path.join(WORKSPACE_ROOT, 'package.json'), 'utf8'));
  expect(ceiling).toEqual(expect.any(Number));
  return String(ceiling);
}

function createFixture(files) {
  const root = makeTemp('verify-like-ci-');
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

// ---------------------------------------------------------------------------
// lint-staged glob derivation
// ---------------------------------------------------------------------------

describe('globExtensions', () => {
  it('expands a braced lint-staged glob into every extension', () => {
    expect(globExtensions('*.{json,md,yml,yaml}')).toEqual(['.json', '.md', '.yml', '.yaml']);
  });

  it('expands a single-extension glob', () => {
    expect(globExtensions('*.ts')).toEqual(['.ts']);
  });

  it('ignores a non-extension glob (nothing to hand prettier)', () => {
    expect(globExtensions('packages/**/src')).toEqual([]);
  });
});

describe('lintStagedExtensions', () => {
  it('derives the union of every configured glob, deduplicated and sorted', () => {
    expect(
      lintStagedExtensions({
        '*.{ts,tsx}': ['eslint --fix', 'prettier --write'],
        '*.{js,mjs,cjs}': ['prettier --write'],
        '*.{json,md,yml,yaml}': ['prettier --write'],
      }),
    ).toEqual(['.cjs', '.js', '.json', '.md', '.mjs', '.ts', '.tsx', '.yaml', '.yml']);
  });

  it('is derived from the config, not hardcoded — a narrowed config narrows the set', () => {
    expect(lintStagedExtensions({ '*.md': ['prettier --write'] })).toEqual(['.md']);
  });

  it('reads the live .lintstagedrc.json and includes the YAML/markdown drift extensions', () => {
    const live = readLintStagedExtensions(WORKSPACE_ROOT);
    // The #1369 drift class was a prettier-wrapped YAML array inside a markdown frontmatter block.
    expect(live).toContain('.md');
    expect(live).toContain('.yml');
    expect(live).toContain('.yaml');
    expect(live).toContain('.ts');
  });
});

describe('selectFormatTargets', () => {
  const extensions = ['.md', '.ts', '.yml'];

  it('keeps only formatter-owned files', () => {
    expect(
      selectFormatTargets(
        ['a.md', 'b.ts', 'c.png', 'd.yml', 'packages/foo/src/x.snap'],
        extensions,
      ),
    ).toEqual(['a.md', 'b.ts', 'd.yml']);
  });

  it('deduplicates a file reported by more than one git query', () => {
    expect(selectFormatTargets(['a.md', 'a.md', 'a.md'], extensions)).toEqual(['a.md']);
  });

  it('matches the extension case-insensitively', () => {
    expect(selectFormatTargets(['README.MD'], extensions)).toEqual(['README.MD']);
  });
});

describe('parseGitFileList', () => {
  it('splits, trims and drops empty lines', () => {
    expect(parseGitFileList('a.md\n b.ts \n\n')).toEqual(['a.md', 'b.ts']);
  });

  it('returns an empty list for no output', () => {
    expect(parseGitFileList(undefined)).toEqual([]);
  });
});

describe('resolveDistFreeSubject', () => {
  it('uses CI-provided PR identity without consulting symbolic-ref on detached HEAD', () => {
    const calls = [];
    const subject = resolveDistFreeSubject(
      {
        PR_HEAD_SHA: '0123456789abcdef0123456789abcdef01234567',
        GITHUB_HEAD_REF: 'codex/detached-pr',
      },
      (args) => {
        calls.push(args);
        throw new Error('detached HEAD has no symbolic ref');
      },
    );

    expect(subject).toEqual({
      subjectSha: '0123456789abcdef0123456789abcdef01234567',
      subjectBranch: 'codex/detached-pr',
    });
    expect(calls).toEqual([]);
  });

  it('injects the original subject into the detached scan process', async () => {
    const calls = [];
    const code = await runWithDistFreeSubject(
      (...args) => {
        calls.push(args);
        return Promise.resolve(0);
      },
      ['scan.mjs'],
      '/detached/tree',
      { PR_HEAD_SHA: 'subject-sha', GITHUB_HEAD_REF: 'codex/subject' },
      () => {
        throw new Error('provided identity must not query git');
      },
    );

    expect(code).toBe(0);
    expect(calls).toEqual([
      [
        'node',
        ['scan.mjs'],
        '/detached/tree',
        { env: { PR_HEAD_SHA: 'subject-sha', GITHUB_HEAD_REF: 'codex/subject' } },
      ],
    ]);
  });
});

describe('collectChangedFiles', () => {
  it('unions base-diff, working-tree and untracked files (untracked would else be invisible)', () => {
    const calls = [];
    const runner = (args) => {
      calls.push(args.join(' '));
      if (args.includes('ls-files')) return ['scripts/harness/verify-like-ci.mjs'];
      if (args.includes('HEAD') && !args.some((a) => a.includes('...'))) return ['package.json'];
      return ['AGENTS.md'];
    };
    const files = collectChangedFiles('origin/develop', runner);
    // Only files that exist on disk survive; all three of these do in this repo.
    expect(files).toContain('AGENTS.md');
    expect(files).toContain('package.json');
    expect(files).toContain('scripts/harness/verify-like-ci.mjs');
    expect(calls.some((call) => call.includes('origin/develop...HEAD'))).toBe(true);
    expect(calls.some((call) => call.includes('ls-files --others'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dist presence
// ---------------------------------------------------------------------------

describe('listBuildablePackageDirs', () => {
  it('lists only packages that declare build:js (the script root `pnpm build` fans out to)', () => {
    const root = createFixture({
      'packages/built/package.json': JSON.stringify({ scripts: { 'build:js': 'x' } }),
      'packages/no-build/package.json': JSON.stringify({ scripts: { test: 'x' } }),
      'packages/dag-nodes/nested/package.json': JSON.stringify({ scripts: { 'build:js': 'x' } }),
    });
    expect(listBuildablePackageDirs(root)).toEqual(['packages/built', 'packages/dag-nodes/nested']);
  });

  it('finds the live workspace packages (the real dist set CI restores)', () => {
    expect(listBuildablePackageDirs(WORKSPACE_ROOT).length).toBeGreaterThan(10);
  });
});

describe('findMissingDist', () => {
  it('reports every buildable package with no dist/ — an unbuilt tree must not read as a pass', () => {
    const root = createFixture({
      'packages/built/package.json': '{}',
      'packages/built/dist/index.js': '',
      'packages/unbuilt/package.json': '{}',
    });
    expect(findMissingDist(['packages/built', 'packages/unbuilt'], undefined, root)).toEqual([
      'packages/unbuilt',
    ]);
  });

  it('returns nothing when every package is built', () => {
    const root = createFixture({ 'packages/built/dist/index.js': '' });
    expect(findMissingDist(['packages/built'], undefined, root)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// unbuilt tree (HARNESS-058): a stage must not report on ground the tree lacks
// ---------------------------------------------------------------------------

const CONSUMER = { name: 'typecheck', needsBuildOutput: true };
const PRODUCER = { name: 'build', needsBuildOutput: false };

/** A run that has not reached `build` yet, on a tree with nothing built. */
const pendingBuild = { buildPending: true, buildFailed: false, missingDist: ['packages/a'] };

describe('stageBlockCause', () => {
  it('does NOT block while `build` is still ahead — the output is about to appear', () => {
    expect(stageBlockCause(CONSUMER, pendingBuild)).toBeNull();
  });

  it('blocks as `unprepared` when no build will run and nothing is built', () => {
    expect(
      stageBlockCause(CONSUMER, {
        buildPending: false,
        buildFailed: false,
        missingDist: ['packages/a'],
      }),
    ).toBe('unprepared');
  });

  /**
   * The reviewer disagreement this pins, settled by measurement rather than argument. A build that
   * was ATTEMPTED is not build output. Measured on a fresh worktree with a real build regression:
   * `examples-typecheck` emitted `TS2307: Cannot find module '@robota-sdk/agent-framework'` and a
   * spurious "install @types/node" hint; `binary-e2e` spent 20s waiting for a serve host that was
   * never built. Neither is a verdict on the change.
   */
  it('blocks as `build-failed` once `build` ran and FAILED with dist still absent', () => {
    expect(
      stageBlockCause(CONSUMER, {
        buildPending: false,
        buildFailed: true,
        missingDist: ['packages/a'],
      }),
    ).toBe('build-failed');
  });

  it('does NOT block after a successful build — dist is there', () => {
    expect(
      stageBlockCause(CONSUMER, { buildPending: false, buildFailed: false, missingDist: [] }),
    ).toBeNull();
  });

  it('never blocks a stage that reads no build output — the fast tier still runs unbuilt', () => {
    expect(stageBlockCause(PRODUCER, { ...pendingBuild, buildPending: false })).toBeNull();
    expect(
      stageBlockCause(
        { name: 'format-check', needsBuildOutput: false },
        {
          ...pendingBuild,
          buildPending: false,
        },
      ),
    ).toBeNull();
  });

  it('blocks every build-output stage the real table declares, so none can fake a verdict', () => {
    const consumers = CI_STAGES.filter((stage) => stage.needsBuildOutput);
    expect(consumers.length).toBeGreaterThan(0);
    for (const stage of consumers) {
      expect(
        stageBlockCause(stage, {
          buildPending: false,
          buildFailed: true,
          missingDist: ['packages/a'],
        }),
        `\`${stage.name}\` declares it reads build output but would still run after a FAILED build`,
      ).toBe('build-failed');
    }
  });
});

describe('advanceBuildState', () => {
  it('leaves the state alone for any stage that is not `build`', () => {
    expect(advanceBuildState(pendingBuild, CONSUMER, 0, () => [])).toEqual(pendingBuild);
  });

  it('re-reads dist from DISK after a successful build rather than assuming it appeared', () => {
    const next = advanceBuildState(pendingBuild, PRODUCER, 0, () => []);
    expect(next).toEqual({ buildPending: false, buildFailed: false, missingDist: [] });
  });

  it('records the failure and keeps the dist it actually found after a FAILED build', () => {
    const next = advanceBuildState(pendingBuild, PRODUCER, 1, () => ['packages/a']);
    expect(next).toEqual({
      buildPending: false,
      buildFailed: true,
      missingDist: ['packages/a'],
    });
  });
});

describe('the loop sequence a run actually walks', () => {
  /** Replay the loop's state transitions over an ordered stage list. */
  const replay = (stages, buildCode, distAfterBuild) => {
    let state = { buildPending: true, buildFailed: false, missingDist: ['packages/a'] };
    const seen = [];
    for (const stage of stages) {
      seen.push([stage.name, stageBlockCause(stage, state)]);
      state = advanceBuildState(state, stage, stage.name === 'build' ? buildCode : 0, () => [
        ...distAfterBuild,
      ]);
    }
    return seen;
  };

  it('a FAILED build blocks every consumer that follows it', () => {
    expect(replay([PRODUCER, CONSUMER], 1, ['packages/a'])).toEqual([
      ['build', null],
      ['typecheck', 'build-failed'],
    ]);
  });

  it('a successful build blocks nothing that follows it', () => {
    expect(replay([PRODUCER, CONSUMER], 0, [])).toEqual([
      ['build', null],
      ['typecheck', null],
    ]);
  });
});

// ---------------------------------------------------------------------------
// dist-free tree (HARNESS-047): the scans CI runs on a checkout with NO dist
// ---------------------------------------------------------------------------

const CI_SCANS_JOB_FIXTURE = `
  scans:
    name: scans
    steps:
      - name: Harness scan test suite
        run: pnpm harness:test
      - name: Harness scan suite (dist-independent)
        run: |
          scan_args=(harness:scan -- --skip dist --skip build-contracts --affected --context pr --base "\${HARNESS_BASE_REF}")
          if [[ "$BENCHMARK_MODE" == "true" ]]; then
            scan_args+=(--skip lane-declaration --skip user-execution-plan-order --skip work-run-measurement)
          fi
          start_check scans pnpm "\${scan_args[@]}"
`;

describe('parseDistIndependentScanSkips', () => {
  it("derives the skip set from ci.yml's scans job instead of hardcoding it", () => {
    expect(parseDistIndependentScanSkips(CI_SCANS_JOB_FIXTURE)).toEqual([
      'dist',
      'build-contracts',
    ]);
  });

  it('follows CI drift — a third skip in ci.yml is picked up automatically', () => {
    const drifted = CI_SCANS_JOB_FIXTURE.replace(
      '--skip build-contracts',
      '--skip build-contracts --skip docs-structure',
    );
    expect(parseDistIndependentScanSkips(drifted)).toEqual([
      'dist',
      'build-contracts',
      'docs-structure',
    ]);
  });

  it('does not add benchmark-only skips to the mirrored PR scan set', () => {
    expect(parseDistIndependentScanSkips(CI_SCANS_JOB_FIXTURE)).not.toContain('lane-declaration');
    expect(parseDistIndependentScanSkips(CI_SCANS_JOB_FIXTURE)).not.toContain(
      'user-execution-plan-order',
    );
    expect(parseDistIndependentScanSkips(CI_SCANS_JOB_FIXTURE)).not.toContain(
      'work-run-measurement',
    );
  });

  it('fails closed when a scan_args append is not benchmark-only', () => {
    const unguarded = CI_SCANS_JOB_FIXTURE.replace(
      'if [[ "$BENCHMARK_MODE" == "true" ]]; then',
      'if [[ "$RUN_HERMETIC" == "true" ]]; then',
    );
    expect(() => parseDistIndependentScanSkips(unguarded)).toThrow(
      /outside the BENCHMARK_MODE-only branch/,
    );
  });

  it('fails closed when the dynamic scan_args command is not invoked exactly once', () => {
    expect(() =>
      parseDistIndependentScanSkips(
        CI_SCANS_JOB_FIXTURE.replace('start_check scans pnpm "\${scan_args[@]}"', ''),
      ),
    ).toThrow(/exactly one/);
  });

  it('throws when no dist-independent scan step exists — never silently scans nothing', () => {
    expect(() => parseDistIndependentScanSkips('jobs:\n  scans:\n    steps: []\n')).toThrow(
      /harness:scan/,
    );
  });

  it('throws when ci.yml has more than one such invocation (ambiguous mirror target)', () => {
    expect(() => parseDistIndependentScanSkips(CI_SCANS_JOB_FIXTURE.repeat(2))).toThrow(
      /more than one/i,
    );
  });

  it('reads the LIVE ci.yml — the stage mirrors the real job, not a copy of it', () => {
    expect(readDistIndependentScanSkips(WORKSPACE_ROOT)).toEqual(['dist', 'build-contracts']);
  });
});

describe('listNodeModulesOwners', () => {
  it('lists every dir owning an installed node_modules (linked so the scans can run)', () => {
    const root = createFixture({
      'node_modules/vitest/index.js': '',
      'packages/a/node_modules/dep/index.js': '',
      'packages/a/dist/index.js': '',
      'packages/b/src/index.ts': '',
    });
    expect(listNodeModulesOwners(root)).toEqual(['', 'packages/a']);
  });

  it('never descends into node_modules or dist (their inner installs are irrelevant)', () => {
    const root = createFixture({
      'node_modules/dep/node_modules/nested/index.js': '',
      'packages/a/dist/node_modules/ghost/index.js': '',
    });
    expect(listNodeModulesOwners(root)).toEqual(['']);
  });

  it('finds the live workspace installs (root + packages)', () => {
    const owners = listNodeModulesOwners(WORKSPACE_ROOT);
    expect(owners).toContain('');
    expect(owners.some((dir) => dir.startsWith('packages/'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stage table + summary + args
// ---------------------------------------------------------------------------

describe('CI_STAGES', () => {
  it('covers the build and package-test gates the entry point used to omit (INFRA-056)', () => {
    const names = CI_STAGES.map((stage) => stage.name);
    // The two the name promised and the command did not deliver.
    expect(names).toContain('build');
    expect(names).toContain('package-quality');
    // Cheap, dist-free stages run first so a formatting or commit-message defect surfaces in
    // seconds rather than behind the minutes-long build and PTY suites.
    expect(names.indexOf('format-check')).toBeLessThan(names.indexOf('build'));
    expect(names.indexOf('commitlint')).toBeLessThan(names.indexOf('build'));
    expect(names.indexOf('build')).toBeLessThan(names.indexOf('scan-suite'));
    expect(names.indexOf('build')).toBeLessThan(names.indexOf('package-quality'));
    expect(names.indexOf('build')).toBeLessThan(names.indexOf('tui-e2e'));
  });

  it('mirrors BOTH CI scan halves — the built-tree job and the dist-free job (neither replaces the other)', () => {
    const built = CI_STAGES.find((stage) => stage.name === 'scan-suite');
    const distFree = CI_STAGES.find((stage) => stage.name === 'scan-suite-dist-free');
    // `build` owns the build-dependent scan after producing dist; `scans` runs on a fresh checkout.
    const builtSource = describeCiSource(built);
    expect(builtSource).toBe('ci.yml → build → Build-output contracts scan (dist-dependent)');
    expect(builtSource).not.toMatch(/→ quality →/);
    expect(describeCiSource(distFree)).toMatch(/scans/);
    expect(describeCiSource(distFree)).toMatch(/dist/);
    expect(builtSource).not.toEqual(describeCiSource(distFree));
  });

  it('passes the original branch and head identity into detached dist-free scans', () => {
    const source = readFileSync(
      path.resolve(import.meta.dirname, '../verify-like-ci-dist-free.mjs'),
      'utf8',
    );
    expect(source).toContain('runWithDistFreeSubject(run, args, treeDir, process.env, gitOrThrow)');
    expect(source).toContain("'--affected'");
    expect(source).toContain("'--context',\n      'pr'");
    expect(source).toContain("run('pnpm', ['harness:scan:build-contracts'])");
  });

  it('names the real definition each stage mirrors, or says out loud that it mirrors none', () => {
    for (const stage of CI_STAGES) {
      // A mirrored stage is traceable to the workflow; an `extra` stage must declare what it
      // covers instead, so no stage can sit in the table without an accountable reason.
      expect(describeCiSource(stage)).toMatch(stage.mirrors ? /ci\.yml/ : /no CI job/);
      expect(stage.why.length).toBeGreaterThan(0);
    }
  });

  it('has a runnable implementation for every declared stage — no stage is a table entry only', async () => {
    const source = readFileSync(
      path.resolve(import.meta.dirname, '../verify-like-ci-execution.mjs'),
      'utf8',
    );
    const runners = /const STAGE_RUNNERS = \{([\s\S]*?)\n\};/.exec(source);
    expect(runners).not.toBeNull();
    for (const stage of CI_STAGES) {
      expect(
        runners[1].includes(`'${stage.name}'`) || runners[1].includes(`\n  ${stage.name}:`),
        `stage \`${stage.name}\` is declared in the mirror map but STAGE_RUNNERS has no runner for it — the map would claim coverage the command cannot execute.`,
      ).toBe(true);
    }
  });
});

describe('stageGate', () => {
  const base = {
    distRequired: false,
    codeChanged: true,
    productChanged: false,
    tuiChanged: false,
    examplesChanged: false,
    cliChanged: false,
    harnessChanged: false,
    fullProductVerification: false,
    missingDist: [],
  };

  it('does not turn harness-only requirements or stale dist into product applicability', () => {
    expect(stageGate('build', { ...base, distRequired: true }).run).toBe(false);
    expect(stageGate('build', { ...base, missingDist: ['packages/agent-core'] }).run).toBe(false);
  });

  it('builds on product changes but not infrastructure-only code changes', () => {
    // The plan predicate alone does not see those two dist consumers — the narrow gate would leave
    // the PTY suite driving whatever stale binary happened to be in the worktree.
    expect(stageGate('build', { ...base, productChanged: true }).run).toBe(true);
    expect(stageGate('build', base).run).toBe(false);
  });

  it('skips the build when no product capability is affected', () => {
    const gate = stageGate('build', base);
    expect(gate.run).toBe(false);
    expect(gate.note).toMatch(/product build N\/A/);
  });

  it('gates binary-e2e and the e2e suites on the same conditions CI gates their jobs on', () => {
    expect(stageGate('binary-e2e', { ...base, cliChanged: true }).run).toBe(true);
    expect(stageGate('binary-e2e', base).run).toBe(false);
    expect(stageGate('tui-e2e', { ...base, tuiChanged: true }).run).toBe(true);
    expect(stageGate('tui-e2e', base).run).toBe(false);
    expect(stageGate('examples-typecheck', { ...base, examplesChanged: true }).run).toBe(true);
    expect(stageGate('examples-typecheck', base).run).toBe(false);
  });

  it('skips only the hermetic harness tier for a proven non-harness change', () => {
    expect(stageGate('harness-self-test', base).run).toBe(true);
    expect(stageGate('harness-hermetic-test', base).run).toBe(false);
    expect(stageGate('harness-hermetic-test', { ...base, harnessChanged: true }).run).toBe(true);
    expect(stageGate('harness-hermetic-test', { ...base, harnessChanged: undefined }).run).toBe(
      true,
    );
  });

  it('runs infrastructure stages unconditionally and product quality only when applicable', () => {
    for (const name of ['format-check', 'commitlint', 'harness-self-test']) {
      expect(stageGate(name, base).run).toBe(true);
    }
    expect(stageGate('scan-suite', base).run).toBe(false);
    expect(stageGate('package-quality', base).run).toBe(false);
    expect(stageGate('scan-suite', { ...base, productChanged: true }).run).toBe(true);
    expect(stageGate('package-quality', { ...base, productChanged: true }).run).toBe(true);
  });
});

describe('local product classification and commands', () => {
  it('keeps harness full-contract fallback separate from product-full verification', () => {
    const result = classifyLocalProductChanges(['scripts/harness/check-plan.mjs'], {
      cwd: WORKSPACE_ROOT,
    });

    expect(result.classification.full).toBe(false);
    expect(result.productChanged).toBe(false);
    expect(result.fullProductVerification).toBe(false);
    expect(result).toMatchObject({
      tuiChanged: false,
      examplesChanged: false,
      windowsChanged: false,
      cliChanged: false,
    });
  });

  it('uses direct ownership for ordinary product capabilities', () => {
    const result = classifyLocalProductChanges(['packages/agent-transport-tui/src/index.ts'], {
      cwd: WORKSPACE_ROOT,
    });

    expect(result.productChanged).toBe(true);
    expect(result.fullProductVerification).toBe(false);
    expect(result.tuiChanged).toBe(true);
    expect(result.examplesChanged).toBe(false);
  });

  it('selects affected scripts normally and full scripts only in product-full mode', () => {
    const options = { baseRef: 'origin/develop' };
    const affected = { fullProductVerification: false };
    const full = { fullProductVerification: true };

    expect(createProductStageCommands('build', options, affected)).toEqual([
      ['pnpm', ['build:affected', '--', '--base-ref', 'origin/develop']],
    ]);
    expect(createProductStageCommands('package-quality', options, affected)).toEqual([
      ['pnpm', ['test:affected', '--', '--base-ref', 'origin/develop']],
      ['pnpm', ['typecheck:affected', '--', '--base-ref', 'origin/develop']],
      ['pnpm', ['lint:affected', '--', '--base-ref', 'origin/develop']],
      [
        'pnpm',
        expect.arrayContaining([
          'eslint',
          'packages',
          'apps',
          '--cache-strategy',
          'content',
          '--max-warnings',
          declaredWorkspaceLintCeiling(),
        ]),
      ],
    ]);
    expect(createProductStageCommands('examples-typecheck', options, affected)).toEqual([
      ['pnpm', ['examples:typecheck:affected', '--', '--base-ref', 'origin/develop']],
    ]);
    expect(createProductStageCommands('package-quality', options, full)).toEqual([
      ['pnpm', ['test']],
      ['pnpm', ['typecheck']],
      ['pnpm', ['lint']],
    ]);
  });

  // The whole-workspace eslint this stage runs once carried its own frozen literal, which drifted
  // from the ceiling the root `lint` script declares and turned a passing tree red locally. Pinning
  // the expectation to a number here would have stayed green through that drift, so it is pinned to
  // the manifest the ceiling actually belongs to: reintroduce a literal that disagrees and this
  // goes red.
  it('takes the whole-workspace lint ceiling from the root manifest, not a literal of its own', () => {
    const commands = createProductStageCommands(
      'package-quality',
      { baseRef: 'origin/develop' },
      { fullProductVerification: false },
    );
    const [, args] = commands.at(-1);

    expect(args).toEqual(expect.arrayContaining(['packages', 'apps']));
    expect(args[args.indexOf('--max-warnings') + 1]).toBe(declaredWorkspaceLintCeiling());
  });
});

describe('annotateNotMirrored', () => {
  it('marks the dependency audit RELEVANT when the diff touches a manifest or the lockfile', () => {
    const entries = annotateNotMirrored(['pnpm-lock.yaml']);
    expect(entries.find((entry) => entry.context === 'dependency audit').relevant).toBe(true);
    expect(
      annotateNotMirrored(['packages/agent-core/package.json']).find(
        (entry) => entry.context === 'dependency audit',
      ).relevant,
    ).toBe(true);
  });

  it('leaves it un-flagged on a diff that cannot change the dependency graph', () => {
    expect(
      annotateNotMirrored(['.agents/rules/git-branch.md']).find(
        (entry) => entry.context === 'dependency audit',
      ).relevant,
    ).toBe(false);
  });

  it('marks windows-shell relevant only when product code changes', () => {
    const find = (files) =>
      annotateNotMirrored(files).find((entry) => entry.context === 'windows-shell').relevant;
    expect(find(['packages/agent-core/src/index.ts'])).toBe(true);
    expect(find(['scripts/harness/check-plan.mjs'])).toBe(false);
    expect(find(['README.md'])).toBe(false);
  });

  it('always reports every un-mirrorable context, relevant or not', () => {
    expect(annotateNotMirrored([]).map((entry) => entry.context)).toEqual(
      NOT_MIRRORED.map((entry) => entry.context),
    );
  });
});

describe('summarize', () => {
  it('distinguishes not-applicable checks and blocked work from executed checks', () => {
    const execution = {
      selectedChecks: 2,
      applicableChecks: 1,
      executedChecks: 1,
      executedBatches: 1,
    };
    const passed = summarize(
      [
        { name: 'build', status: 'skip' },
        { name: 'commitlint', status: 'pass' },
      ],
      { execution },
    );
    expect(passed.lines.join('\n')).toContain(
      '1 checks executed, 1 not applicable, 1 execution batches; required coverage satisfied',
    );
    const failed = summarize(
      [
        { name: 'commitlint', status: 'fail' },
        { name: 'build', status: 'blocked' },
      ],
      { execution },
    );
    expect(failed.exitCode).toBe(1);
    expect(failed.lines.join('\n')).toContain('1 of 2 stage(s) failed: commitlint');
    expect(failed.lines.join('\n')).toContain('1 check(s) blocked, not executed: build');
  });
  it('reports PASS and exit 0 when every stage passed', () => {
    const { lines, exitCode } = summarize([
      { name: 'harness-self-test', status: 'pass' },
      { name: 'format-check', status: 'pass' },
    ]);
    expect(exitCode).toBe(0);
    expect(lines.join('\n')).toContain('PASS');
  });

  it('prints per-stage and total elapsed times', () => {
    const { lines } = summarize(
      [
        { name: 'format-check', status: 'pass', durationMs: 1234 },
        { name: 'harness-self-test', status: 'pass', durationMs: 65_000 },
      ],
      { totalDurationMs: 66_234 },
    );
    const text = lines.join('\n');
    expect(text).toContain('format-check [1.2s]');
    expect(text).toContain('harness-self-test [1m 5.0s]');
    expect(text).toContain('total elapsed: 1m 6.2s');
  });

  it('a PARTIAL run refuses to call itself CI-equivalent, and names what it did not run', () => {
    // `--only format-check` used to print "PASS — all 1 CI-mirroring stage(s) passed": a full
    // CI-equivalence claim produced by one prettier run. With stages that now cost minutes, that
    // wording is the cheapest way to hollow this gate out.
    const { lines, exitCode } = summarize([{ name: 'format-check', status: 'pass' }], {
      skippedStages: ['build', 'package-quality', 'tui-e2e'],
    });
    expect(exitCode).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain('PARTIAL');
    expect(text).toContain('NOT a CI-equivalent result');
    expect(text).toContain('build, package-quality, tui-e2e');
  });

  it('always prints the un-mirrorable contexts, and shouts when the diff makes one relevant', () => {
    const quiet = summarize([{ name: 'typecheck', status: 'pass' }], {
      notMirrored: annotateNotMirrored(['README.md']),
    }).lines.join('\n');
    expect(quiet).toContain('dependency audit — NOT mirrored locally');
    expect(quiet).toContain('windows-shell — NOT mirrored locally');
    // review-gate judges every PR's body (RULE-016), so it is the one un-mirrorable context that is
    // relevant to every diff; the others stay quiet on a diff that touches nothing of theirs.
    expect(quiet).toContain('review-gate');
    expect(quiet.split('this diff makes it relevant').length - 1).toBe(1);
    expect(quiet).not.toMatch(/dependency audit[^\n]*\n[^\n]*this diff makes it relevant/);

    const loud = summarize([{ name: 'typecheck', status: 'pass' }], {
      notMirrored: annotateNotMirrored(['pnpm-lock.yaml']),
    }).lines.join('\n');
    expect(loud).toContain('this diff makes it relevant');
    expect(loud).toContain('osv-scanner');
  });

  it('names the failing stage and exits 1', () => {
    const { lines, exitCode } = summarize([
      { name: 'harness-self-test', status: 'fail' },
      { name: 'format-check', status: 'pass' },
      { name: 'scan-suite', status: 'fail', note: 'dist missing' },
    ]);
    expect(exitCode).toBe(1);
    const text = lines.join('\n');
    expect(text).toContain('FAIL — 2 of 3 stage(s) failed: harness-self-test, scan-suite');
    expect(text).toContain('dist missing');
    // The failing stage points at the CI definition it mirrors, so the fix target is unambiguous.
    expect(text).toContain('harness-self-test covers ci.yml');
  });
});

describe('the stale-dist hint on a failed typecheck (issue #2200)', () => {
  // Three cross-package type errors in one session, each in a package the branch never touched,
  // each a dist/ older than a commit that landed on develop while the branch was open. The `dist`
  // scan's advisory already said so — among ~140 scan results, at another moment. The hint belongs
  // in the failing stage's own output, and only when something is actually stale.
  it('names the stale packages and the rebuild command when a dist/ is older than its src/', () => {
    const hint = staleDistHint(['@robota-sdk/agent-core', '@robota-sdk/agent-session']);

    expect(hint).toMatch(/^stale dist: @robota-sdk\/agent-core, @robota-sdk\/agent-session/);
    expect(hint).toMatch(/pnpm build/);
  });

  it('does not fire when dist/ is current, so it stays a signal rather than boilerplate', () => {
    expect(staleDistHint([])).toBeNull();
    expect(staleDistHint(undefined)).toBeNull();
  });

  it('applies to exactly the stages whose typecheck reads dist types', () => {
    expect(
      CI_STAGES.map((stage) => stage.name)
        .filter(readsDistTypes)
        .sort(),
    ).toEqual(['examples-typecheck', 'package-quality']);
    expect(readsDistTypes('format-check')).toBe(false);
  });
});

describe('parseArgs', () => {
  it('defaults to every stage against origin/develop', () => {
    const options = parseArgs([]);
    expect(options.only.size).toBe(0);
    expect(options.baseRef).toBe('origin/develop');
    expect(options.allFiles).toBe(false);
    expect(options.full).toBe(false);
    expect(options.unknown).toEqual([]);
  });

  it('parses --only (repeatable), --base-ref, --all-files and --full', () => {
    const options = parseArgs([
      '--only',
      'format-check',
      '--only',
      'package-quality',
      '--base-ref',
      'origin/main',
      '--all-files',
      '--full',
    ]);
    expect([...options.only]).toEqual(['format-check', 'package-quality']);
    expect(options.baseRef).toBe('origin/main');
    expect(options.allFiles).toBe(true);
    expect(options.full).toBe(true);
  });

  it('reports an unknown stage name instead of silently running nothing', () => {
    expect(parseArgs(['--only', 'nope']).unknown).toEqual(['nope']);
  });
});
