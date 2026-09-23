import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  resolveWorkflowDispatchCommit,
  resolveWorkflowDispatchCommitPair,
} from '../git-base-ref-resolution.mjs';
import { main } from '../workflow-dispatch-refs.mjs';
import { makeTemp } from './make-temp.mjs';

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function fixture() {
  const cwd = makeTemp('robota-dispatch-refs-');
  git(cwd, 'init', '-b', 'fixture');
  git(cwd, 'config', 'user.name', 'Ref fixture');
  git(cwd, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(cwd, 'file'), 'base\n');
  git(cwd, 'add', 'file');
  git(cwd, 'commit', '-m', 'base');
  const base = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'update-ref', 'refs/remotes/origin/base', base);
  git(cwd, 'tag', '-a', 'snapshot', '-m', 'annotated base');
  writeFileSync(path.join(cwd, 'file'), 'head\n');
  git(cwd, 'commit', '-am', 'head');
  const head = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'update-ref', 'refs/remotes/origin/head', head);
  return { cwd, base, head };
}

describe('workflow dispatch exact commit pair', () => {
  it('normalizes remote-only branch, annotated tag and full OID to the same pair', () => {
    const { cwd, base, head } = fixture();
    for (const baseRef of ['base', 'refs/heads/base', 'snapshot', 'refs/tags/snapshot', base]) {
      expect(resolveWorkflowDispatchCommitPair({ baseRef, headRef: 'head', cwd })).toEqual({
        baseOid: base,
        headOid: head,
      });
    }
    expect(git(cwd, 'branch', '--list', 'base')).toBe('');
  });

  it('refuses malformed names and revision operators even when Git could resolve them', () => {
    const { cwd, head } = fixture();
    for (const baseRef of [
      'head~1',
      'refs/heads/head~1',
      'head^',
      'head^{commit}',
      'head@{0}',
      '',
      ' head',
      'refs/pull/1/head',
      'missing',
    ]) {
      expect(() => resolveWorkflowDispatchCommitPair({ baseRef, headRef: head, cwd })).toThrow();
    }
  });

  it('rejects ambiguous namespaces and existing non-commit tags', () => {
    const { cwd, base } = fixture();
    git(cwd, 'tag', 'base', base);
    expect(() => resolveWorkflowDispatchCommit('base', { cwd })).toThrow(/ambiguous/);
    const blob = git(cwd, 'rev-parse', 'HEAD:file');
    git(cwd, 'update-ref', 'refs/tags/blob', blob);
    expect(() => resolveWorkflowDispatchCommit('blob', { cwd })).toThrow(/commit is unavailable/);
    expect(resolveWorkflowDispatchCommit('refs/heads/base', { cwd })).toBe(base);
  });

  it.each([
    { status: 1, signal: 'SIGTERM' },
    { status: 1, error: { code: 'ETIMEDOUT' } },
    { status: 128, stderr: 'could not read ref database' },
  ])('does not replace failed branch lookup with a valid tag: %j', (failure) => {
    const runCommand = vi.fn((_command, args) => {
      if (args[0] === 'check-ref-format') return { status: 0 };
      if (args.at(-1) === 'refs/remotes/origin/candidate') return failure;
      if (args[0] === 'show-ref') return { status: 0 };
      return { status: 0, stdout: `${'a'.repeat(40)}\n` };
    });
    expect(() => resolveWorkflowDispatchCommit('candidate', { runCommand })).toThrow(
      /lookup failed/,
    );
    expect(runCommand.mock.calls.some(([, args]) => args.includes('refs/tags/candidate'))).toBe(
      false,
    );
  });

  it('fails closed when command execution throws', () => {
    expect(() =>
      resolveWorkflowDispatchCommit('base', {
        runCommand() {
          throw new Error('spawn failed');
        },
      }),
    ).toThrow(/could not execute/);
  });
});

describe('workflow dispatch controller CLI', () => {
  it('imports silently without dispatch environment or output writes', () => {
    const cwd = makeTemp('robota-dispatch-import-');
    const output = path.join(cwd, 'output');
    writeFileSync(output, 'sentinel');
    const file = path.resolve(import.meta.dirname, '../workflow-dispatch-refs.mjs');
    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(file).href)})`],
      {
        cwd,
        env: {
          ...process.env,
          BASE_REF: '',
          HEAD_REF: '',
          GITHUB_OUTPUT: output,
        },
        encoding: 'utf8',
      },
    );
    expect({
      status: child.status,
      stdout: child.stdout,
      stderr: child.stderr,
    }).toEqual({ status: 0, stdout: '', stderr: '' });
    expect(readFileSync(output, 'utf8')).toBe('sentinel');
  });

  it('resolves from controller HEAD before a distinct target checkout', () => {
    const { cwd, base, head } = fixture();
    git(cwd, 'checkout', '--detach', base);
    const output = path.join(cwd, 'output');
    expect(
      main({
        cwd,
        env: { BASE_REF: 'base', HEAD_REF: 'head', GITHUB_OUTPUT: output },
      }),
    ).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe(`base_oid=${base}\nhead_oid=${head}\n`);
    expect(git(cwd, 'rev-parse', 'HEAD')).toBe(base);
    git(cwd, 'checkout', '--detach', head);
    expect(git(cwd, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('never publishes partial outputs after a failed normalization or merge-base check', () => {
    const { cwd, base, head } = fixture();
    const append = vi.fn();
    expect(() =>
      main({
        cwd,
        env: { BASE_REF: 'missing', HEAD_REF: head, GITHUB_OUTPUT: 'output' },
        append,
      }),
    ).toThrow();
    expect(() => main({ cwd, env: { BASE_REF: base, HEAD_REF: head }, append })).toThrow(
      /GITHUB_OUTPUT/,
    );
    expect(() =>
      main({
        cwd,
        env: { BASE_REF: base, HEAD_REF: head, GITHUB_OUTPUT: 'output' },
        append,
        runCommand(command, args, options) {
          if (args[0] === 'merge-base') return { status: 1, signal: 'SIGTERM', stdout: '' };
          return spawnSync(command, args, { ...options, encoding: 'utf8' });
        },
      }),
    ).toThrow(/merge base/);
    expect(append).not.toHaveBeenCalled();
  });
});
