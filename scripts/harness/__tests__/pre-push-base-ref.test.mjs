import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { makeTemp } from './make-temp.mjs';

// harness-coverage: git-base-ref-resolution.mjs

import {
  createPrePushBasePlan,
  resolvePrePushBaseRef,
  selectPushBoundBranch,
} from '../pre-push-base-ref.mjs';
import {
  isPrePushHookInvocation,
  isPrePushInputWellFormed,
  resolvePrePushHookContext,
} from '../pre-push-work-run.mjs';
import { classifyRange } from '../classify-changed-paths.mjs';
import { resolveGitBaseRef } from '../shared.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const OTHER = 'c'.repeat(40);

function update({
  localRef = 'refs/heads/feature',
  localObjectId = HEAD,
  remoteRef = 'refs/heads/feature',
  remoteObjectId = OTHER,
} = {}) {
  return { localRef, localObjectId, remoteRef, remoteObjectId };
}

function commandRunner({ candidates = [], objectExists = true, fetchedOid = BASE } = {}) {
  const calls = [];
  const executionOptions = [];
  const runCommand = vi.fn((command, args, options) => {
    calls.push([command, args]);
    executionOptions.push(options);
    if (command === 'gh') return { status: 0, stdout: JSON.stringify(candidates), stderr: '' };
    if (args[0] === 'check-ref-format') return { status: 0, stdout: '', stderr: '' };
    if (args[0] === 'cat-file') return { status: objectExists ? 0 : 1, stdout: '', stderr: '' };
    if (args[0] === 'fetch') return { status: 0, stdout: '', stderr: '' };
    if (args[0] === 'rev-parse') return { status: 0, stdout: `${fetchedOid}\n`, stderr: '' };
    throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
  });
  return { calls, executionOptions, runCommand };
}

function candidate(overrides = {}) {
  return {
    baseRefName: 'integration',
    baseRefOid: BASE,
    headRefName: 'feature',
    state: 'OPEN',
    isCrossRepository: false,
    ...overrides,
  };
}

describe('selectPushBoundBranch (INFRA-099)', () => {
  it('accepts one exact current-branch push and the no-stdin manual path', () => {
    expect(
      selectPushBoundBranch({
        updates: [update()],
        hookInputProvided: true,
        currentBranch: 'feature',
        headOid: HEAD,
      }),
    ).toEqual({
      ok: true,
      branch: 'feature',
      localRef: 'refs/heads/feature',
      localObjectId: HEAD,
      source: 'push-update',
    });
    expect(
      selectPushBoundBranch({
        updates: [],
        hookInputProvided: false,
        currentBranch: 'feature',
        headOid: HEAD,
      }),
    ).toEqual({
      ok: true,
      branch: 'feature',
      localRef: 'refs/heads/feature',
      localObjectId: HEAD,
      source: 'checkout',
    });
  });

  it.each([
    ['another local branch', [update({ localRef: 'refs/heads/other' })], 'feature', HEAD],
    ['a renamed remote ref', [update({ remoteRef: 'refs/heads/renamed' })], 'feature', HEAD],
    ['multiple refs', [update(), update()], 'feature', HEAD],
    ['detached HEAD', [update()], '', HEAD],
    ['a different local object', [update({ localObjectId: OTHER })], 'feature', HEAD],
  ])('rejects %s', (_label, updates, currentBranch, headOid) => {
    expect(
      selectPushBoundBranch({ updates, hookInputProvided: true, currentBranch, headOid }).ok,
    ).toBe(false);
  });

  it('preserves delete-only pushes without inventing a checkout subject', () => {
    expect(
      selectPushBoundBranch({
        updates: [update({ localRef: '(delete)', localObjectId: '0'.repeat(40) })],
        hookInputProvided: true,
        currentBranch: 'feature',
        headOid: HEAD,
      }),
    ).toEqual({ ok: true, deleteOnly: true, source: 'push-update' });
  });
});

describe('pre-push hook input syntax', () => {
  it('accepts only complete four-field hook lines', () => {
    expect(
      isPrePushInputWellFormed(`refs/heads/feature ${HEAD} refs/heads/feature ${OTHER}\n`),
    ).toBe(true);
    expect(isPrePushInputWellFormed(`refs/heads/feature ${HEAD} refs/heads/feature\n`)).toBe(false);
    expect(
      isPrePushInputWellFormed(
        `refs/heads/feature ${HEAD} refs/heads/feature ${OTHER} unexpected\n`,
      ),
    ).toBe(false);
    expect(
      isPrePushInputWellFormed(`refs/heads/feature not-an-oid refs/heads/feature ${OTHER}\n`),
    ).toBe(false);
  });

  it('recognizes the Git hook from its remote arguments even when stdin is empty', () => {
    expect(
      isPrePushHookInvocation({
        inputProvided: false,
        remoteName: 'origin',
        remoteUrl: 'git@github.com:woojubb/robota.git',
      }),
    ).toBe(true);
    expect(
      isPrePushHookInvocation({ inputProvided: false, remoteName: null, remoteUrl: null }),
    ).toBe(false);
    expect(() =>
      resolvePrePushHookContext({
        prePushInput: { input: '', provided: false },
        updates: [],
        currentBranch: 'feature',
        headOid: HEAD,
        env: { HARNESS_PRE_PUSH_REMOTE_NAME: 'origin' },
      }),
    ).toThrow(/malformed/i);
  });
});

describe('resolvePrePushBaseRef (INFRA-099)', () => {
  const common = {
    updates: [update()],
    hookInputProvided: true,
    currentBranch: 'feature',
    headOid: HEAD,
    pushRemoteName: 'origin',
    pushRemoteUrl: 'git@github.com:woojubb/robota.git',
    originUrl: 'git@github.com:woojubb/robota.git',
    env: {},
  };

  it('uses one same-repository OPEN PR and returns its immutable base OID', () => {
    const { calls, runCommand } = commandRunner({ candidates: [candidate()] });
    const result = resolvePrePushBaseRef({
      ...common,
      runCommand,
      resolveFallback: vi.fn(() => 'origin/develop'),
    });

    expect(result).toEqual({ baseRef: BASE, source: 'pull-request', fallbackReason: null });
    expect(calls[0]).toEqual([
      'gh',
      [
        'pr',
        'list',
        '--state',
        'open',
        '--head',
        'feature',
        '--json',
        'baseRefName,baseRefOid,headRefName,state,isCrossRepository',
      ],
    ]);
  });

  it('keeps explicit HARNESS_BASE_REF authoritative without consulting GitHub', () => {
    const runCommand = vi.fn();
    expect(
      resolvePrePushBaseRef({
        ...common,
        explicitBaseRef: 'custom-base',
        runCommand,
        resolveFallback: vi.fn((value) => value),
      }),
    ).toEqual({ baseRef: 'custom-base', source: 'explicit', fallbackReason: null });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('delegates misses to the existing resolver, preserving GITHUB_BASE_REF', () => {
    const fallback = vi.fn((_explicit, env) =>
      env.GITHUB_BASE_REF === 'release' ? 'origin/release' : 'origin/develop',
    );
    const result = resolvePrePushBaseRef({
      ...common,
      env: { GITHUB_BASE_REF: 'release' },
      runCommand: commandRunner({ candidates: [] }).runCommand,
      resolveFallback: fallback,
    });
    expect(result.baseRef).toBe('origin/release');
    expect(result.source).toBe('fallback');
    expect(result.fallbackReason).toMatch(/no open pull request/i);
    expect(fallback).toHaveBeenCalledWith(null, { GITHUB_BASE_REF: 'release' });
  });

  it.each([
    ['multiple candidates', [candidate(), candidate({ baseRefOid: OTHER })]],
    ['a cross-repository candidate', [candidate({ isCrossRepository: true })]],
    ['a wrong head', [candidate({ headRefName: 'other' })]],
    ['a closed candidate', [candidate({ state: 'CLOSED' })]],
    ['a malformed OID', [candidate({ baseRefOid: 'ABC' })]],
  ])('falls back for %s', (_label, candidates) => {
    const result = resolvePrePushBaseRef({
      ...common,
      runCommand: commandRunner({ candidates }).runCommand,
      resolveFallback: vi.fn(() => 'origin/develop'),
    });
    expect(result.source).toBe('fallback');
    expect(result.baseRef).toBe('origin/develop');
  });

  it('does not query GitHub when the actual push is not bound to the current branch', () => {
    const runCommand = vi.fn();
    const result = resolvePrePushBaseRef({
      ...common,
      updates: [update({ remoteRef: 'refs/heads/renamed' })],
      runCommand,
      resolveFallback: vi.fn(() => 'origin/develop'),
    });
    expect(result.source).toBe('refused');
    expect(result.refusalReason).toMatch(/renames/i);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it.each([
    ['multiple refs', [update(), update()], true],
    ['a foreign branch', [update({ localRef: 'refs/heads/other' })], true],
    ['a foreign object', [update({ localObjectId: OTHER })], true],
    ['malformed hook input', [update()], false],
  ])('refuses %s instead of falling back to current HEAD/base', (_label, updates, inputValid) => {
    const fallback = vi.fn(() => 'origin/develop');
    const result = resolvePrePushBaseRef({
      ...common,
      updates,
      hookInputWellFormed: inputValid,
      runCommand: vi.fn(),
      resolveFallback: fallback,
    });
    expect(result.source).toBe('refused');
    expect(result.baseRef).toBeNull();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('does not let an explicit base bypass an invalid push subject', () => {
    const result = resolvePrePushBaseRef({
      ...common,
      updates: [update(), update()],
      explicitBaseRef: 'origin/develop',
      runCommand: vi.fn(),
      resolveFallback: vi.fn(() => 'origin/develop'),
    });
    expect(result.source).toBe('refused');
  });

  it.each([
    ['another remote name', { pushRemoteName: 'fork' }],
    ['another remote URL', { pushRemoteUrl: 'git@github.com:other/repo.git' }],
  ])('does not query GitHub when pushing to %s', (_label, overrides) => {
    const runCommand = vi.fn();
    const result = resolvePrePushBaseRef({
      ...common,
      ...overrides,
      runCommand,
      resolveFallback: vi.fn(() => 'origin/develop'),
    });
    expect(result.source).toBe('refused');
    expect(result.refusalReason).toMatch(/remote/i);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it.each([
    ['GitHub command failure', () => ({ status: 1, stdout: '', stderr: 'offline' })],
    ['malformed GitHub JSON', () => ({ status: 0, stdout: '{', stderr: '' })],
  ])('falls back on %s', (_label, ghResult) => {
    const result = resolvePrePushBaseRef({
      ...common,
      runCommand: (command) =>
        command === 'gh' ? ghResult() : { status: 0, stdout: '', stderr: '' },
      resolveFallback: vi.fn(() => 'origin/develop'),
    });
    expect(result.source).toBe('fallback');
    expect(result.baseRef).toBe('origin/develop');
  });

  it('passes a per-command timeout to every spawned gh and git command', () => {
    const { executionOptions, runCommand } = commandRunner({
      candidates: [candidate()],
      objectExists: false,
    });
    const result = resolvePrePushBaseRef({
      ...common,
      commandTimeoutMs: 1_234,
      totalCommandTimeoutMs: 10_000,
      runCommand,
      resolveFallback: vi.fn(() => 'origin/develop'),
    });

    expect(result.source).toBe('pull-request');
    expect(executionOptions).toHaveLength(5);
    expect(executionOptions).toEqual(
      expect.arrayContaining(Array.from({ length: 5 }, () => ({ timeout: 1_234 }))),
    );
  });

  it('fails closed with a distinct reason when one command times out', () => {
    const result = resolvePrePushBaseRef({
      ...common,
      runCommand: vi.fn(() => ({
        status: 1,
        stdout: '',
        stderr: '',
        error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
      })),
      resolveFallback: vi.fn(() => 'origin/develop'),
    });

    expect(result).toEqual({
      baseRef: 'origin/develop',
      source: 'fallback',
      fallbackReason: 'pull request lookup timed out',
    });
  });

  it('shares one command-count budget across gh and git commands', () => {
    const { runCommand } = commandRunner({ candidates: [candidate()] });
    const result = resolvePrePushBaseRef({
      ...common,
      commandBudget: 2,
      runCommand,
      resolveFallback: vi.fn(() => 'origin/develop'),
    });

    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(result.fallbackReason).toBe(
      'pre-push base command budget exhausted before pull request base object lookup',
    );
  });

  it('shares one wall-clock deadline across gh and git commands', () => {
    const { runCommand } = commandRunner({ candidates: [candidate()] });
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(1).mockReturnValueOnce(11);
    const result = resolvePrePushBaseRef({
      ...common,
      totalCommandTimeoutMs: 10,
      now,
      runCommand,
      resolveFallback: vi.fn(() => 'origin/develop'),
    });

    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(result.fallbackReason).toBe(
      'pre-push base command deadline exceeded before pull request base ref validation',
    );
  });

  it('caps each command timeout at the remaining shared deadline', () => {
    const { executionOptions, runCommand } = commandRunner({ candidates: [] });
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(400);
    resolvePrePushBaseRef({
      ...common,
      commandTimeoutMs: 1_000,
      totalCommandTimeoutMs: 500,
      now,
      runCommand,
      resolveFallback: vi.fn(() => 'origin/develop'),
    });

    expect(executionOptions).toEqual([{ timeout: 100 }]);
  });

  it('keeps fallback rev-parse checks inside the PR lookup command budget', () => {
    const { executionOptions, runCommand } = commandRunner({ candidates: [] });
    const result = resolvePrePushBaseRef({
      ...common,
      commandBudget: 1,
      runCommand,
    });

    expect(runCommand).toHaveBeenCalledOnce();
    expect(executionOptions).toEqual([{ timeout: 10_000 }]);
    expect(result).toEqual({
      baseRef: null,
      source: 'refused',
      fallbackReason: 'no open pull request matched the pushed branch',
      refusalReason: 'pre-push base command budget exhausted before fallback base ref lookup',
    });
  });

  it('keeps fallback rev-parse checks inside the PR lookup wall-clock deadline', () => {
    const { runCommand } = commandRunner({ candidates: [] });
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(1).mockReturnValueOnce(16);
    const result = resolvePrePushBaseRef({
      ...common,
      totalCommandTimeoutMs: 15,
      now,
      runCommand,
    });

    expect(runCommand).toHaveBeenCalledOnce();
    expect(result).toEqual({
      baseRef: null,
      source: 'refused',
      fallbackReason: 'no open pull request matched the pushed branch',
      refusalReason: 'pre-push base command deadline exceeded before fallback base ref lookup',
    });
  });

  it('fails closed distinctly when an injected command runner throws', () => {
    const result = resolvePrePushBaseRef({
      ...common,
      runCommand: vi.fn(() => {
        throw new Error('spawn failed');
      }),
      resolveFallback: vi.fn(() => 'origin/develop'),
    });

    expect(result.fallbackReason).toBe('pull request lookup could not execute');
    expect(result.baseRef).toBe('origin/develop');
  });

  it('fetches only the advertised full base ref via argv and accepts matching FETCH_HEAD', () => {
    const { calls, runCommand } = commandRunner({
      candidates: [candidate()],
      objectExists: false,
      fetchedOid: BASE,
    });
    const result = resolvePrePushBaseRef({
      ...common,
      runCommand,
      resolveFallback: vi.fn(() => 'origin/develop'),
    });
    expect(result.source).toBe('pull-request');
    expect(calls).toContainEqual([
      'git',
      ['fetch', '--no-tags', 'origin', 'refs/heads/integration'],
    ]);
  });

  it('falls back when lookup and fetch disagree on the advertised OID', () => {
    const result = resolvePrePushBaseRef({
      ...common,
      runCommand: commandRunner({
        candidates: [candidate()],
        objectExists: false,
        fetchedOid: OTHER,
      }).runCommand,
      resolveFallback: vi.fn(() => 'origin/develop'),
    });
    expect(result).toEqual({
      baseRef: 'origin/develop',
      source: 'fallback',
      fallbackReason: 'fetched base OID did not match the pull request base OID',
    });
  });

  it('falls back when the exact advertised base cannot be fetched', () => {
    const runCommand = (command, args) => {
      if (command === 'gh') {
        return { status: 0, stdout: JSON.stringify([candidate()]), stderr: '' };
      }
      if (args[0] === 'check-ref-format') return { status: 0, stdout: '', stderr: '' };
      if (args[0] === 'cat-file') return { status: 1, stdout: '', stderr: '' };
      if (args[0] === 'fetch') return { status: 1, stdout: '', stderr: 'network' };
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    };
    const result = resolvePrePushBaseRef({
      ...common,
      runCommand,
      resolveFallback: vi.fn(() => 'origin/develop'),
    });
    expect(result.fallbackReason).toBe('pull request base ref fetch failed');
    expect(result.baseRef).toBe('origin/develop');
  });
});

describe('resolveGitBaseRef environment seam (INFRA-099)', () => {
  it('uses the injected GitHub base instead of the process environment', () => {
    expect(resolveGitBaseRef(null, { GITHUB_BASE_REF: 'main' })).toBe('origin/main');
  });

  it('bounds every fallback rev-parse under one resolver deadline', () => {
    const timeouts = [];
    const runCommand = vi.fn((_command, _args, options) => {
      timeouts.push(options.timeout);
      return { status: 1, stdout: '', stderr: '' };
    });
    const now = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(14_900)
      .mockReturnValueOnce(15_001);

    expect(() =>
      resolveGitBaseRef(null, {}, { runCommand, now, totalCommandTimeoutMs: 15_000 }),
    ).toThrow(/git base ref command deadline exceeded before origin\/main lookup/i);
    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(timeouts).toEqual([10_000, 100]);
  });

  it('distinguishes a fallback rev-parse timeout from an absent ref', () => {
    expect(() =>
      resolveGitBaseRef(
        null,
        {},
        {
          runCommand: () => ({
            status: 1,
            stdout: '',
            stderr: '',
            error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
          }),
        },
      ),
    ).toThrow(/git base ref lookup timed out for origin\/develop/i);
  });
});

describe('createPrePushBasePlan (INFRA-099)', () => {
  it('projects one exact base into plan, classification, decision, and receipt consumers', () => {
    const plan = createPrePushBasePlan({
      baseRef: BASE,
      source: 'pull-request',
      fallbackReason: null,
    });
    expect(plan).toEqual({
      baseRef: BASE,
      baseArgs: ['--base-ref', BASE],
      classificationBaseRef: BASE,
      decisionBaseRef: BASE,
      receiptBaseRef: BASE,
      source: 'pull-request',
      fallbackReason: null,
    });
  });

  it('refuses to create a plan from an unresolved push subject', () => {
    expect(() =>
      createPrePushBasePlan({
        baseRef: null,
        source: 'refused',
        fallbackReason: null,
        refusalReason: 'multiple updates',
      }),
    ).toThrow(/multiple updates/i);
  });
});

describe('integration-child delta isolation (INFRA-099)', () => {
  it('excludes cumulative initiative history only when the unique PR base is trusted', () => {
    const root = makeTemp('infra099-base-');
    const repo = path.join(root, 'repo');
    const origin = path.join(root, 'origin.git');
    const git = (...args) =>
      execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
    const write = (relative, contents) => {
      const target = path.join(repo, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, contents);
    };
    const commit = (message) => {
      git('add', '.');
      git('commit', '--quiet', '-m', message);
      return git('rev-parse', 'HEAD');
    };

    try {
      execFileSync('git', ['init', '--quiet', '--bare', origin]);
      execFileSync('git', ['init', '--quiet', '--initial-branch=develop', repo]);
      git('config', 'user.email', 'infra099@example.test');
      git('config', 'user.name', 'INFRA-099');
      git('remote', 'add', 'origin', origin);
      write('README.md', 'base\n');
      const developOid = commit('develop base');
      git('switch', '--quiet', '-c', 'integration');
      write('packages/example/src/cumulative.ts', 'export const cumulative = true;\n');
      const integrationOid = commit('initiative history');
      git('switch', '--quiet', '-c', 'feature');
      for (let index = 1; index <= 4; index += 1) write(`docs/child-${index}.md`, `${index}\n`);
      const childOid = commit('child completion docs');

      const runCommand = (command, args) => {
        if (command === 'gh') {
          return {
            status: 0,
            stdout: JSON.stringify([
              candidate({ baseRefName: 'integration', baseRefOid: integrationOid }),
            ]),
            stderr: '',
          };
        }
        const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
        return {
          status: result.status ?? 1,
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
        };
      };

      const exact = resolvePrePushBaseRef({
        updates: [
          update({
            localObjectId: childOid,
            remoteObjectId: '0'.repeat(40),
          }),
        ],
        hookInputProvided: true,
        currentBranch: 'feature',
        headOid: childOid,
        pushRemoteName: 'origin',
        pushRemoteUrl: origin,
        originUrl: origin,
        runCommand,
        resolveFallback: () => developOid,
      });
      const exactDelta = classifyRange({ baseRef: exact.baseRef, head: childOid, cwd: repo });
      expect(exact.source).toBe('pull-request');
      expect(exactDelta.files).toEqual([
        'docs/child-1.md',
        'docs/child-2.md',
        'docs/child-3.md',
        'docs/child-4.md',
      ]);

      const broad = resolvePrePushBaseRef({
        updates: [update({ localObjectId: childOid })],
        hookInputProvided: true,
        currentBranch: 'feature',
        headOid: childOid,
        pushRemoteName: 'origin',
        pushRemoteUrl: origin,
        originUrl: origin,
        runCommand: (command, args) =>
          command === 'gh' ? { status: 0, stdout: '[]', stderr: '' } : runCommand(command, args),
        resolveFallback: () => developOid,
      });
      const broadDelta = classifyRange({ baseRef: broad.baseRef, head: childOid, cwd: repo });
      expect(broad.source).toBe('fallback');
      expect(broadDelta.files).toEqual([
        'docs/child-1.md',
        'docs/child-2.md',
        'docs/child-3.md',
        'docs/child-4.md',
        'packages/example/src/cumulative.ts',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
