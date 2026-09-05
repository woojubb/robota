import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { makeTemp } from './make-temp.mjs';
import {
  createAffectedContractPlan,
  createDeterministicShards,
  estimateContractTestWeights,
  matchesContractRepositoryInput,
  parseNameStatusDiff,
  resolveChangedContractInputs,
} from '../affected-contract-tests.mjs';
import {
  CONTRACT_CONTROL_PLANE_INPUTS,
  CONTRACT_SAFETY_FLOOR,
  createContractTestRegistry,
  relativeImportClosure,
  validateContractTestRegistry,
} from '../contract-test-inputs.mjs';
import { groupContractTestsByOwner } from '../contract-test-owners.mjs';
import {
  classifyHarnessTestFiles,
  contractShardTimeoutMs,
  createActiveShardChildRegistry,
  DEFAULT_CONTRACT_SHARD_TIMEOUT_MS,
  vitestInvocationAsync,
} from '../harness-test-tiers.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const TEST_ROOT = 'scripts/harness/__tests__';

function fixture() {
  const root = makeTemp('robota-affected-contracts-');
  const files = {
    floor: `${TEST_ROOT}/affected-contract-tests.test.mjs`,
    alpha: `${TEST_ROOT}/alpha.test.mjs`,
    beta: `${TEST_ROOT}/beta.test.mjs`,
    gamma: `${TEST_ROOT}/gamma.test.mjs`,
    delta: `${TEST_ROOT}/delta.test.mjs`,
    epsilon: `${TEST_ROOT}/epsilon.test.mjs`,
    isolated: `${TEST_ROOT}/isolated.test.mjs`,
    workspace: `${TEST_ROOT}/workspace.test.mjs`,
    global: `${TEST_ROOT}/global.test.mjs`,
    crossWorkspace: `${TEST_ROOT}/cross-workspace.test.mjs`,
    narrowCrossWorkspace: `${TEST_ROOT}/narrow-cross-workspace.test.mjs`,
  };
  mkdirSync(path.join(root, TEST_ROOT), { recursive: true });
  mkdirSync(path.join(root, 'scripts/harness/lib'), { recursive: true });
  for (const name of ['alpha', 'beta']) {
    mkdirSync(path.join(root, 'packages', name), { recursive: true });
    writeFileSync(path.join(root, 'packages', name, 'package.json'), '{}\n');
  }
  writeFileSync(
    path.join(root, files.floor),
    "import '../lib/shared.mjs';\nconst owner = '.agents/rules/**';\n",
  );
  writeFileSync(
    path.join(root, files.alpha),
    "import '../lib/alpha.mjs';\nconst owner = 'packages/alpha/**';\n",
  );
  writeFileSync(path.join(root, files.beta), "const owner = 'packages/beta/**';\n");
  writeFileSync(path.join(root, files.gamma), 'export const gamma = true;\n');
  writeFileSync(path.join(root, files.delta), 'export const delta = true;\n');
  writeFileSync(path.join(root, files.epsilon), 'export const epsilon = true;\n');
  writeFileSync(path.join(root, files.isolated), "import '../lib/shared.mjs';\n");
  writeFileSync(path.join(root, files.workspace), "const owner = 'packages/**';\n");
  writeFileSync(path.join(root, files.global), "const owner = 'pnpm-workspace.yaml';\n");
  writeFileSync(
    path.join(root, files.crossWorkspace),
    "const packages = 'packages/**';\nconst docs = 'docs/**';\n",
  );
  writeFileSync(
    path.join(root, files.narrowCrossWorkspace),
    "const alpha = 'packages/alpha/src/**';\nconst docs = 'docs/**';\n",
  );
  writeFileSync(
    path.join(root, 'scripts/harness/lib/alpha.mjs'),
    "export * from './shared.mjs';\n",
  );
  writeFileSync(path.join(root, 'scripts/harness/lib/shared.mjs'), 'export const shared = true;\n');
  const contracts = Object.values(files);
  return {
    root,
    files,
    contracts,
    isolated: [files.isolated],
    registry: createContractTestRegistry(root, contracts),
  };
}

describe('affected contract selection', () => {
  it('selects real agent-definition consumers instead of the complete tier or only the safety floor', () => {
    const tiers = classifyHarnessTestFiles(REPO_ROOT);
    const registry = createContractTestRegistry(REPO_ROOT, tiers.contract);
    for (const agent of ['mechanical-refactor-worker', 'pr-review-fixer']) {
      const plan = createAffectedContractPlan({
        root: REPO_ROOT,
        contractTests: tiers.contract,
        registry,
        changedFiles: [`.claude/agents/${agent}.md`],
      });
      expect(plan.mode, agent).toBe('affected');
      expect(plan.selected.length).toBeLessThan(tiers.contract.length);
      expect(plan.selected).toEqual(
        expect.arrayContaining([
          ...CONTRACT_SAFETY_FLOOR.map(({ test }) => test),
          ...[
            'check-agent-def-convention',
            'agents-cannot-be-told-to-dispatch',
            'depth-verdict-reachable',
            'scan-retired-agent-references',
          ].map((name) => `${TEST_ROOT}/${name}.test.mjs`),
        ]),
      );
      if (agent === 'pr-review-fixer')
        expect(plan.selected).toContain(`${TEST_ROOT}/review-before-push.test.mjs`);
    }
  });

  it('retains both rename sides and rejects malformed name-status output', () => {
    expect(parseNameStatusDiff('R100\0old.mjs\0new.mjs\0M\0same.mjs\0')).toEqual([
      'new.mjs',
      'old.mjs',
      'same.mjs',
    ]);
    expect(() => parseNameStatusDiff('R100\0only-one-side\0')).toThrow('unreadable');
  });

  it('resolves all merge bases and fails closed on empty or unreadable diffs', () => {
    const calls = [];
    const runGit = (args) => {
      calls.push(args);
      if (args[0] === 'merge-base') return { status: 0, stdout: 'base-a\nbase-b\n' };
      if (args.includes('base-a')) return { status: 0, stdout: 'M\0packages/a.ts\0' };
      return { status: 0, stdout: 'R100\0packages/old.ts\0packages/new.ts\0' };
    };
    expect(
      resolveChangedContractInputs({ root: '/repo', baseRef: 'develop', runGit }).files,
    ).toEqual(['packages/a.ts', 'packages/new.ts', 'packages/old.ts']);
    expect(calls.filter((args) => args[0] === 'diff')).toHaveLength(2);
    expect(
      resolveChangedContractInputs({
        root: '/repo',
        baseRef: 'develop',
        runGit: (args) =>
          args[0] === 'merge-base' ? { status: 0, stdout: 'base\n' } : { status: 0, stdout: '' },
      }),
    ).toMatchObject({ ok: false, reason: 'changed-file diff was empty' });
  });

  it('selects changed tests, relative import dependents, and explicit repository inputs', () => {
    const data = fixture();
    const plan = (changedFiles) =>
      createAffectedContractPlan({
        root: data.root,
        contractTests: data.contracts,
        isolatedContract: data.isolated,
        registry: data.registry,
        changedFiles,
      });

    expect(plan([data.files.beta])).toMatchObject({
      mode: 'affected',
      selected: expect.arrayContaining([data.files.floor, data.files.beta]),
    });
    expect(plan(['scripts/harness/lib/alpha.mjs']).selected).toEqual([
      data.files.floor,
      data.files.alpha,
    ]);
    expect(plan(['scripts/harness/lib/shared.mjs']).selected).toEqual(
      expect.arrayContaining([data.files.floor, data.files.alpha, data.files.isolated]),
    );
    expect(plan(['packages/beta/src/index.ts']).selected).toEqual(
      [data.files.floor, data.files.beta].sort(),
    );
    expect(plan(['.agents/rules/verification.md']).selected).toEqual([data.files.floor]);
  });

  it('isolates package source while retaining only narrower matching global contracts', () => {
    const data = fixture();
    expect(data.registry.find(({ test }) => test === data.files.crossWorkspace)?.primaryOwner).toBe(
      'workspace:global',
    );
    const plan = (file) =>
      createAffectedContractPlan({
        root: data.root,
        contractTests: data.contracts,
        isolatedContract: data.isolated,
        registry: data.registry,
        changedFiles: [file],
      });
    const alpha = plan('packages/alpha/src/new-feature.ts');
    expect(alpha).toMatchObject({ mode: 'affected', isolated: [] });
    expect(alpha.selected).toEqual(
      [data.files.floor, data.files.alpha, data.files.narrowCrossWorkspace].sort(),
    );
    expect(alpha.selected).not.toContain(data.files.crossWorkspace);
    expect(alpha.selected).not.toContain(data.files.workspace);
    expect(alpha.selected).not.toContain(data.files.beta);
    expect(plan('packages/beta/src/new-feature.ts').selected).not.toContain(data.files.alpha);
    expect(alpha.shards.flat().sort()).toEqual(alpha.selected);
    expect(new Set(alpha.shards.flat()).size).toBe(alpha.selected.length);
    expect(alpha.selectedByOwner).toEqual(
      [...alpha.selectedByOwner].sort((left, right) => left.owner.localeCompare(right.owner)),
    );
  });

  it('treats exact broad domain globs as structural unless source ownership is explicit', () => {
    const data = fixture();
    const plan = (registry = data.registry) =>
      createAffectedContractPlan({
        root: data.root,
        contractTests: data.contracts,
        isolatedContract: data.isolated,
        registry,
        changedFiles: ['packages/alpha/src/new-feature.ts'],
      });

    expect(plan().selected).not.toContain(data.files.workspace);
    const explicit = data.registry.map((entry) =>
      entry.test === data.files.workspace ? { ...entry, broadSourceDomains: ['packages'] } : entry,
    );
    expect(plan(explicit).selected).toContain(data.files.workspace);

    const structural = createAffectedContractPlan({
      root: data.root,
      contractTests: data.contracts,
      isolatedContract: data.isolated,
      registry: data.registry,
      changedFiles: ['packages/alpha/package.json'],
    });
    expect(structural.mode).toBe('affected');
    expect(structural.selected).toEqual(
      expect.arrayContaining([data.files.workspace, data.files.crossWorkspace]),
    );
  });

  it.each([
    [[], 'missing or empty'],
    [['package.json'], 'control-plane'],
    [['unknown/unregistered-owner.txt'], 'unknown owner'],
    [['outside-root.txt'], 'unknown owner'],
    [['.claude/settings.json'], 'unknown owner'],
    [['.claude/agents-backup/worker.md'], 'unknown owner'],
  ])('falls back completely for %j', (changedFiles, reason) => {
    const data = fixture();
    const result = createAffectedContractPlan({
      root: data.root,
      contractTests: data.contracts,
      isolatedContract: data.isolated,
      registry: data.registry,
      changedFiles,
    });
    expect(result.mode).toBe('complete');
    expect(result.reason).toContain(reason);
    expect(result.shards).toHaveLength(4);
    expect(result.shards.flat().sort()).toEqual(
      data.contracts.filter((file) => file !== data.files.isolated).sort(),
    );
    expect(result.isolated).toEqual([data.files.isolated]);
  });

  it('classifies Claude hook files as governance inputs', () => {
    const data = fixture();
    const result = createAffectedContractPlan({
      root: data.root,
      contractTests: data.contracts,
      isolatedContract: data.isolated,
      registry: data.registry,
      changedFiles: ['.claude/hooks/unregistered.sh'],
    });
    expect(result.mode).toBe('affected');
    expect(result.selected).toEqual([data.files.floor]);
  });

  it('uses the complete fallback for every contract control-plane input', () => {
    const data = fixture();
    for (const input of CONTRACT_CONTROL_PLANE_INPUTS) {
      const changed = input.includes('*') ? input.replaceAll('**', 'ci.yml') : input;
      const result = createAffectedContractPlan({
        root: data.root,
        contractTests: data.contracts,
        isolatedContract: data.isolated,
        registry: data.registry,
        changedFiles: [changed],
      });
      expect(result.mode, input).toBe('complete');
      expect(result.reason, input).toContain('control-plane');
    }
  });

  it('fails closed for a harness path with no actual contract dependency', () => {
    const data = fixture();
    const result = createAffectedContractPlan({
      root: data.root,
      contractTests: data.contracts,
      isolatedContract: data.isolated,
      registry: data.registry,
      changedFiles: ['scripts/harness/unmatched-helper.mjs'],
    });
    expect(result).toMatchObject({
      mode: 'complete',
      reason: expect.stringContaining('unmatched harness implementation'),
    });
  });

  it('falls back for invalid registry or zero selection', () => {
    const data = fixture();
    expect(
      createAffectedContractPlan({
        root: data.root,
        contractTests: data.contracts,
        registry: data.registry.slice(1),
        changedFiles: ['packages/a.ts'],
      }).reason,
    ).toContain('invalid registry');
    const malformedOwners = data.registry.map((entry, index) =>
      index === 0 ? { ...entry, primaryOwner: '' } : entry,
    );
    expect(
      createAffectedContractPlan({
        root: data.root,
        contractTests: data.contracts,
        registry: malformedOwners,
        changedFiles: ['packages/alpha/src/a.ts'],
      }),
    ).toMatchObject({
      mode: 'complete',
      selectedByOwner: [{ owner: 'harness', tests: [...data.contracts].sort() }],
    });
    const noFloor = data.registry.map((entry) => ({
      ...entry,
      always: false,
      alwaysReason: null,
      primaryOwner: entry.test === data.files.global ? 'harness' : entry.primaryOwner,
    }));
    expect(
      createAffectedContractPlan({
        root: data.root,
        contractTests: data.contracts,
        registry: noFloor,
        changedFiles: ['content/unowned.md'],
      }).reason,
    ).toContain('zero tests');
  });

  it('uses deterministic LPT shards and keeps heavy tests apart', () => {
    const files = ['heavy-a', 'light-b', 'heavy-b', 'light-a', 'light-c'];
    const weights = new Map([
      ['heavy-a', 1_000],
      ['heavy-b', 900],
      ['light-a', 20],
      ['light-b', 20],
      ['light-c', 20],
    ]);
    const first = createDeterministicShards(files, 2, weights);
    expect(first).toEqual(createDeterministicShards([...files].reverse(), 2, weights));
    expect(first.findIndex((shard) => shard.includes('heavy-a'))).not.toBe(
      first.findIndex((shard) => shard.includes('heavy-b')),
    );
    expect(first.flat().sort()).toEqual(files.sort());
    expect(new Set(first.flat()).size).toBe(files.length);
  });

  it('retains tests with invalid or missing weights using a safe default', () => {
    const files = ['valid', 'invalid', 'missing', 'negative'];
    const shards = createDeterministicShards(files, 2, {
      valid: 50,
      invalid: Number.NaN,
      negative: -1,
    });
    expect(shards.flat().sort()).toEqual(files.sort());
    expect(new Set(shards.flat()).size).toBe(files.length);
  });

  it('estimates first-run weight from closure cost and accepts measured durations', () => {
    const root = makeTemp('robota-contract-weight-');
    const light = `${TEST_ROOT}/light.test.mjs`;
    const heavy = `${TEST_ROOT}/heavy.test.mjs`;
    mkdirSync(path.join(root, TEST_ROOT), { recursive: true });
    writeFileSync(path.join(root, light), 'export const light = true;\n');
    writeFileSync(
      path.join(root, heavy),
      [
        "spawnSync('git', ['init', '--bare', repo]);",
        "execFileSync('git', ['clone', origin, clone]);",
        'await Promise.all(tasks.map(runTask));',
      ].join('\n'),
    );
    const registry = [light, heavy].map((test) => ({ test, implementationInputs: [test] }));
    const estimated = estimateContractTestWeights({ root, files: [light, heavy], registry });
    expect(estimated.get(heavy)).toBeGreaterThan(estimated.get(light) * 10);

    const measured = estimateContractTestWeights({
      root,
      files: [light, heavy],
      registry,
      measuredDurations: { [light]: 777, [heavy]: Number.NaN },
    });
    expect(measured.get(light)).toBe(777);
    expect(measured.get(heavy)).toBe(estimated.get(heavy));
  });

  it('uses supplied weights only for complete fallback planning', () => {
    const data = fixture();
    const measuredDurations = Object.fromEntries(data.contracts.map((file) => [file, 1]));
    measuredDurations[data.files.floor] = 1_000;
    measuredDurations[data.files.epsilon] = 900;
    const complete = createAffectedContractPlan({
      root: data.root,
      contractTests: data.contracts,
      isolatedContract: data.isolated,
      registry: data.registry,
      changedFiles: [],
      measuredDurations,
    });
    expect(complete.shards.findIndex((shard) => shard.includes(data.files.floor))).not.toBe(
      complete.shards.findIndex((shard) => shard.includes(data.files.epsilon)),
    );

    const affected = createAffectedContractPlan({
      root: data.root,
      contractTests: data.contracts,
      isolatedContract: data.isolated,
      registry: data.registry,
      changedFiles: ['packages/beta/src/index.ts'],
      measuredDurations,
    });
    expect(affected).toMatchObject({ mode: 'affected' });
    expect(affected.shards).toEqual([
      affected.selected.filter((file) => file !== data.files.isolated),
    ]);
  });

  it('exposes every owner in deterministic root fallback fan-out', () => {
    const data = fixture();
    const plan = createAffectedContractPlan({
      root: data.root,
      contractTests: data.contracts,
      isolatedContract: data.isolated,
      registry: data.registry,
      changedFiles: [],
    });
    expect(plan.mode).toBe('complete');
    expect(plan.ownerGroups).toEqual(plan.selectedByOwner);
    expect(plan.ownerGroups.flatMap(({ tests }) => tests).sort()).toEqual(
      [...data.contracts].sort(),
    );
    expect(plan.ownerGroups.reduce((total, { tests }) => total + tests.length, 0)).toBe(
      data.contracts.length,
    );
    expect(plan.selectedByOwner.map(({ owner }) => owner)).toEqual(
      expect.arrayContaining([
        'harness',
        'package:alpha',
        'package:beta',
        'workspace:global',
        'workspace:packages',
      ]),
    );
    expect(new Set(plan.shards.flat()).size + plan.isolated.length).toBe(data.contracts.length);
  });
});

describe('contract input registry', () => {
  it('represents every live contract test exactly once with validated metadata', () => {
    const tiers = classifyHarnessTestFiles(REPO_ROOT);
    const registry = createContractTestRegistry(REPO_ROOT, tiers.contract);
    expect(validateContractTestRegistry(REPO_ROOT, tiers.contract, registry)).toBe(registry);
    expect(registry.map((entry) => entry.test).sort()).toEqual(tiers.contract);
    expect(registry.every(({ primaryOwner }) => typeof primaryOwner === 'string')).toBe(true);
    const groups = groupContractTestsByOwner(registry);
    expect(groups.reduce((total, { tests }) => total + tests.length, 0)).toBe(
      tiers.contract.length,
    );
    expect(registry.filter((entry) => entry.always)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          test: `${TEST_ROOT}/affected-contract-tests.test.mjs`,
          alwaysReason: expect.stringMatching(/selector/),
        }),
        expect.objectContaining({
          test: `${TEST_ROOT}/harness-test-tiers.test.mjs`,
          alwaysReason: expect.stringMatching(/partition/),
        }),
      ]),
    );
    const productPlan = createAffectedContractPlan({
      root: REPO_ROOT,
      contractTests: tiers.contract,
      isolatedContract: tiers.isolatedContract,
      registry,
      changedFiles: ['packages/agent-core/src/new-feature.ts'],
    });
    expect(productPlan).toMatchObject({ mode: 'affected' });
    expect(productPlan.selected).toContain(`${TEST_ROOT}/affected-contract-tests.test.mjs`);
    const selected = new Set(productPlan.selected);
    expect(
      registry.filter(
        (entry) =>
          selected.has(entry.test) &&
          entry.primaryOwner.startsWith('package:') &&
          entry.primaryOwner !== 'package:agent-core' &&
          !entry.always,
      ),
    ).toEqual([]);

    for (const owner of ['agent-provider-openai', 'agent-core']) {
      const file = `packages/${owner}/src/provider-like.ts`;
      const plan = createAffectedContractPlan({
        root: REPO_ROOT,
        contractTests: tiers.contract,
        isolatedContract: tiers.isolatedContract,
        registry,
        changedFiles: [file],
      });
      const planTests = new Set(plan.selected);
      const broadOnlyGlobals = registry.filter(
        (entry) =>
          !entry.always &&
          entry.primaryOwner === 'workspace:global' &&
          entry.repositoryInputs.includes('packages/**') &&
          !entry.repositoryInputs.some(
            (input) =>
              input !== 'packages/**' && matchesContractRepositoryInput(entry, file, input),
          ),
      );
      expect(
        broadOnlyGlobals.filter(({ test }) => planTests.has(test)),
        owner,
      ).toEqual([]);
    }
  });

  it('follows relative static re-exports and rejects duplicate declarations', () => {
    const data = fixture();
    expect(relativeImportClosure(data.root, data.files.alpha)).toEqual([
      data.files.alpha,
      'scripts/harness/lib/alpha.mjs',
      'scripts/harness/lib/shared.mjs',
    ]);
    expect(() =>
      createContractTestRegistry(data.root, [data.files.alpha, data.files.alpha]),
    ).toThrow('duplicate');
    const duplicateInput = data.registry.map((entry) =>
      entry.test === data.files.alpha
        ? { ...entry, implementationInputs: [entry.test, entry.test] }
        : entry,
    );
    expect(() => validateContractTestRegistry(data.root, data.contracts, duplicateInput)).toThrow(
      'duplicate contract registry input',
    );
    const reasonlessAlways = data.registry.map((entry) =>
      entry.test === data.files.alpha ? { ...entry, always: true, alwaysReason: null } : entry,
    );
    expect(() => validateContractTestRegistry(data.root, data.contracts, reasonlessAlways)).toThrow(
      'always-run reason',
    );
  });

  it('treats a signalled shard as failure and removes its owned temporary root', async () => {
    const root = makeTemp('robota-affected-signal-');
    const capture = path.join(root, 'temp-root.txt');
    mkdirSync(path.join(root, 'node_modules/vitest'), { recursive: true });
    writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
    writeFileSync(
      path.join(root, 'node_modules/vitest/vitest.mjs'),
      [
        "import { writeFileSync } from 'node:fs';",
        'writeFileSync(process.env.AFFECTED_TEMP_CAPTURE, process.env.TMPDIR);',
        "process.kill(process.pid, 'SIGTERM');",
      ].join('\n'),
    );
    const previous = process.env.AFFECTED_TEMP_CAPTURE;
    process.env.AFFECTED_TEMP_CAPTURE = capture;
    try {
      const result = await vitestInvocationAsync(root, ['fixture.test.mjs']);
      expect(result).toMatchObject({ status: 1, signal: 'SIGTERM' });
      expect(result.stderr).toContain('terminated by signal SIGTERM');
      const ownedTemp = readFileSync(capture, 'utf8');
      expect(existsSync(ownedTemp)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.AFFECTED_TEMP_CAPTURE;
      else process.env.AFFECTED_TEMP_CAPTURE = previous;
    }
  });

  it.each(['SIGINT', 'SIGTERM'])(
    'forwards parent %s and cleans after child close',
    async (signal) => {
      const root = makeTemp('robota-parent-signal-');
      mkdirSync(path.join(root, 'node_modules/vitest'), { recursive: true });
      writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
      writeFileSync(path.join(root, 'node_modules/vitest/vitest.mjs'), 'export {};\n');
      const parent = new EventEmitter();
      const childRegistry = createActiveShardChildRegistry(parent);
      let ownedTemp;
      let child;
      const spawnChild = vi.fn((_command, _args, options) => {
        ownedTemp = options.env.TMPDIR;
        child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = vi.fn((forwarded) => {
          queueMicrotask(() => child.emit('close', 0, null));
          return forwarded === signal;
        });
        return child;
      });

      const pending = vitestInvocationAsync(root, ['fixture.test.mjs'], {
        spawnChild,
        childRegistry,
      });
      parent.emit(signal);
      const result = await pending;

      expect(child.kill).toHaveBeenCalledWith(signal);
      expect(result).toMatchObject({ status: 1, signal });
      expect(existsSync(ownedTemp)).toBe(false);
      expect(childRegistry.size).toBe(0);
      expect(parent.listenerCount(signal)).toBe(0);
    },
  );

  it('uses a safe configurable process-level shard deadline', () => {
    expect(DEFAULT_CONTRACT_SHARD_TIMEOUT_MS).toBe(240_000);
    expect(contractShardTimeoutMs({})).toBe(DEFAULT_CONTRACT_SHARD_TIMEOUT_MS);
    expect(contractShardTimeoutMs({ HARNESS_CONTRACT_SHARD_TIMEOUT_MS: '45000' })).toBe(45_000);
    expect(contractShardTimeoutMs({ HARNESS_CONTRACT_SHARD_TIMEOUT_MS: 'invalid' })).toBe(
      DEFAULT_CONTRACT_SHARD_TIMEOUT_MS,
    );
  });

  it('marks a deadline SIGTERM close as timeout and clears its grace timer', async () => {
    vi.useFakeTimers();
    try {
      const root = makeTemp('robota-shard-timeout-term-');
      mkdirSync(path.join(root, 'node_modules/vitest'), { recursive: true });
      writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
      writeFileSync(path.join(root, 'node_modules/vitest/vitest.mjs'), 'export {};\n');
      const parent = new EventEmitter();
      const childRegistry = createActiveShardChildRegistry(parent);
      let ownedTemp;
      let child;
      const spawnChild = (_command, _args, options) => {
        ownedTemp = options.env.TMPDIR;
        child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = vi.fn((signal) => {
          if (signal === 'SIGTERM') queueMicrotask(() => child.emit('close', 0, null));
          return true;
        });
        return child;
      };
      const pending = vitestInvocationAsync(root, ['fixture.test.mjs'], {
        spawnChild,
        childRegistry,
        timeoutMs: 25,
        killGraceMs: 10,
      });

      await vi.advanceTimersByTimeAsync(25);
      const result = await pending;

      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(result).toMatchObject({
        status: 1,
        signal: null,
        timedOut: true,
        termination: 'timeout',
      });
      expect(result.stderr).toContain('exceeded process deadline');
      expect(existsSync(ownedTemp)).toBe(false);
      expect(childRegistry.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('escalates a hung shard to SIGKILL and keeps temp state until close', async () => {
    vi.useFakeTimers();
    try {
      const root = makeTemp('robota-shard-timeout-kill-');
      mkdirSync(path.join(root, 'node_modules/vitest'), { recursive: true });
      writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
      writeFileSync(path.join(root, 'node_modules/vitest/vitest.mjs'), 'export {};\n');
      const parent = new EventEmitter();
      const childRegistry = createActiveShardChildRegistry(parent);
      let ownedTemp;
      let child;
      const spawnChild = (_command, _args, options) => {
        ownedTemp = options.env.TMPDIR;
        child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = vi.fn(() => true);
        return child;
      };
      const pending = vitestInvocationAsync(root, ['fixture.test.mjs'], {
        spawnChild,
        childRegistry,
        timeoutMs: 20,
        killGraceMs: 5,
      });

      await vi.advanceTimersByTimeAsync(20);
      expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
      expect(existsSync(ownedTemp)).toBe(true);
      await vi.advanceTimersByTimeAsync(5);
      expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
      expect(existsSync(ownedTemp)).toBe(true);
      child.emit('close', null, 'SIGKILL');
      const result = await pending;

      expect(result).toMatchObject({
        status: 1,
        signal: 'SIGKILL',
        timedOut: true,
        termination: 'timeout',
      });
      expect(result.stderr).toContain('ignored SIGTERM');
      expect(existsSync(ownedTemp)).toBe(false);
      expect(childRegistry.size).toBe(0);
      expect(parent.listenerCount('SIGTERM')).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
