import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  createPrePushBasePlan,
  resolvePrePushBaseRef,
  selectPushBoundBranch,
} from '../pre-push-base-ref.mjs';
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
  const runCommand = vi.fn((command, args) => {
    calls.push([command, args]);
    if (command === 'gh') return { status: 0, stdout: JSON.stringify(candidates), stderr: '' };
    if (args[0] === 'check-ref-format') return { status: 0, stdout: '', stderr: '' };
    if (args[0] === 'cat-file') return { status: objectExists ? 0 : 1, stdout: '', stderr: '' };
    if (args[0] === 'fetch') return { status: 0, stdout: '', stderr: '' };
    if (args[0] === 'rev-parse') return { status: 0, stdout: `${fetchedOid}\n`, stderr: '' };
    throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
  });
  return { calls, runCommand };
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
    ).toEqual({ ok: true, branch: 'feature' });
    expect(
      selectPushBoundBranch({
        updates: [],
        hookInputProvided: false,
        currentBranch: 'feature',
        headOid: HEAD,
      }),
    ).toEqual({ ok: true, branch: 'feature' });
  });

  it.each([
    ['another local branch', [update({ localRef: 'refs/heads/other' })], 'feature', HEAD],
    ['a renamed remote ref', [update({ remoteRef: 'refs/heads/renamed' })], 'feature', HEAD],
    ['multiple refs', [update(), update()], 'feature', HEAD],
    ['detached HEAD', [update()], '', HEAD],
    ['a different local object', [update({ localObjectId: OTHER })], 'feature', HEAD],
    [
      'a deleted ref',
      [update({ localRef: '(delete)', localObjectId: '0'.repeat(40) })],
      'feature',
      HEAD,
    ],
  ])('rejects %s', (_label, updates, currentBranch, headOid) => {
    expect(
      selectPushBoundBranch({ updates, hookInputProvided: true, currentBranch, headOid }).ok,
    ).toBe(false);
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
    expect(result.source).toBe('fallback');
    expect(result.fallbackReason).toMatch(/renames/i);
    expect(runCommand).not.toHaveBeenCalled();
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
    expect(result.source).toBe('fallback');
    expect(result.fallbackReason).toMatch(/remote/i);
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
