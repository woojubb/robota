// harness-coverage: work-run-github-pr-lookup.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { attestCurrentOpeningHead } from '../work-run-attest-opening-head.mjs';
import { pullRequestHistory } from '../work-run-git.mjs';
import { createOpeningHeadComment } from '../work-run-opening-head-evidence.mjs';
import { makeTemp } from './make-temp.mjs';

function repository(
  message = 'close run\n\nWork-Run: run-1\nWork-Receipt: g0-r0',
  receiptId = 'g0-r0',
) {
  const root = makeTemp('work-run-attest-');
  execFileSync('git', ['init', '-q', '-b', 'codex/measured'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Harness'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'harness@example.test'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:woojubb/robota.git'], {
    cwd: root,
  });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'base'], { cwd: root });
  const receipt = path.join(root, `.agents/evals/work-runs/run-1/${receiptId}.json`);
  mkdirSync(path.dirname(receipt), { recursive: true });
  writeFileSync(receipt, '{}\n', 'utf8');
  execFileSync('git', ['add', `.agents/evals/work-runs/run-1/${receiptId}.json`], { cwd: root });
  execFileSync('git', ['commit', '-m', message], {
    cwd: root,
  });
  return root;
}

describe('opening-head attestation command', () => {
  it('creates one server-timestamped comment for the pushed g0 closure', () => {
    const root = repository();
    const headOid = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const body = `Work-Run-Opening-Head: v1\nWork-Run: run-1\nHead-Oid: ${headOid}`;
    const calls = [];
    let timestampQueries = 0;
    const result = attestCurrentOpeningHead(root, {
      resolvePr: () => ({ status: 'none' }),
      run: (_command, args) => {
        calls.push(args);
        if (args.includes('--include')) {
          timestampQueries += 1;
          const second = timestampQueries === 1 ? '00' : '01';
          return {
            status: 0,
            stdout: `HTTP/2 200\ndate: Sun, 30 Aug 2026 00:00:${second} GMT\n\n{}`,
          };
        }
        if (args.includes('POST')) {
          return {
            status: 0,
            stdout: JSON.stringify({
              id: 7,
              commit_id: headOid,
              body,
              created_at: '2026-08-30T00:00:00Z',
              updated_at: '2026-08-30T00:00:00Z',
            }),
          };
        }
        return { status: 0, stdout: '[]' };
      },
      wait: () => {},
    });

    expect(result).toEqual({
      status: 'created',
      commentId: 7,
      commentCreatedAt: '2026-08-30T00:00:00Z',
      serverAdvancedAt: '2026-08-30T00:00:01.000Z',
    });
    expect(timestampQueries).toBe(2);
    expect(calls.some((args) => args.includes(`body=${body}`))).toBe(true);
  });

  it('accepts a revisioned generation-zero closure before querying GitHub', () => {
    const root = repository('close run\n\nWork-Run: run-1\nWork-Receipt: g0-r2', 'g0-r2');

    expect(() =>
      attestCurrentOpeningHead(root, {
        resolvePr: () => ({ status: 'none' }),
        run: () => {
          throw new Error('revisioned closure reached GitHub attestation');
        },
      }),
    ).toThrow('revisioned closure reached GitHub attestation');
  });

  it.each(['open', 'closed', 'merged'])(
    'refuses to attest after a %s pull request existed',
    (state) => {
      expect(() =>
        attestCurrentOpeningHead(repository(), {
          resolvePr: () => ({ status: 'exists', number: 7, state }),
          run: () => {
            throw new Error('must not query comments');
          },
        }),
      ).toThrow(/before any pull request has existed/u);
    },
  );

  it('rejects work-run lines outside the terminal Git trailer block', () => {
    const root = repository('close run\n\nWork-Run: run-1\nWork-Receipt: g0-r0\n\ntrailing prose');
    expect(() =>
      attestCurrentOpeningHead(root, {
        resolvePr: () => ({ status: 'none' }),
        run: () => {
          throw new Error('must not create a comment');
        },
      }),
    ).toThrow(/terminal Git trailer block/u);
  });

  it('queries all pull-request states for the branch history', () => {
    const calls = [];
    const result = pullRequestHistory(repository(), 'codex/measured', {
      repository: 'woojubb/robota',
      run: (_command, args) => {
        calls.push(args);
        return { status: 0, stdout: '[{"number":19,"state":"closed"}]' };
      },
    });

    expect(result).toEqual({ status: 'exists', number: 19, state: 'closed' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('state=all');
    expect(calls[0]).toContain('head=woojubb:codex/measured');
  });

  it('fails when GitHub never advances beyond the comment timestamp', () => {
    const root = repository();
    const headOid = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const body = `Work-Run-Opening-Head: v1\nWork-Run: run-1\nHead-Oid: ${headOid}`;
    expect(() =>
      createOpeningHeadComment(
        root,
        'woojubb/robota',
        { runId: 'run-1', headOid },
        {
          run: (_command, args) => {
            if (args.includes('--include')) {
              return {
                status: 0,
                stdout: 'HTTP/2 200\ndate: Sun, 30 Aug 2026 00:00:00 GMT\n\n{}',
              };
            }
            if (args.includes('POST')) {
              return {
                status: 0,
                stdout: JSON.stringify({
                  id: 7,
                  commit_id: headOid,
                  body,
                  created_at: '2026-08-30T00:00:00Z',
                  updated_at: '2026-08-30T00:00:00Z',
                }),
              };
            }
            return { status: 0, stdout: '[]' };
          },
          wait: () => {},
          budget: { remaining: 4, deadline: Date.now() + 10_000 },
        },
      ),
    ).toThrow(/request budget exhausted/u);
  });
});
