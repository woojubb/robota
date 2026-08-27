/**
 * RULE-016 (issue #2403) — the PR-body judge refuses what the rule forbids, accepts what it asks for,
 * and can never contradict the repository's own template.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { firstHeading, judgePrBody } from '../check-pr-body.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const SCRIPT = path.join(WORKSPACE_ROOT, 'scripts/harness/check-pr-body.mjs');

const COMPLIANT = [
  '## Background',
  '',
  'The shutdown-timer test counted process-wide handles, so it was red on develop for anyone with a',
  'SessionStart hook.',
  '',
  '## Purpose',
  '',
  'Make the red mean the host leaked a timer.',
  '',
  'Closes #2383',
  '',
].join('\n');

describe('judgePrBody — what the rule forbids', () => {
  it('refuses a body whose first heading is not `## Background`', () => {
    const verdict = judgePrBody('### Accepted recommendation\n\nA2 — …\n');
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join('\n')).toMatch(/first heading is `### Accepted recommendation`/);
  });

  it('refuses `## Background` that appears after another heading — opens-with, not contains', () => {
    // The rejected body with one heading appended: a presence check would pass it.
    const verdict = judgePrBody('### Accepted recommendation\n\n…\n\n## Background\n\n…\n');
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join('\n')).toMatch(/first heading is `### Accepted recommendation`/);
  });

  it('refuses a body with no heading at all', () => {
    const verdict = judgePrBody('Closes #1\n\nsome prose\n');
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join('\n')).toMatch(/no heading/);
  });

  it('refuses an agent-session link', () => {
    const verdict = judgePrBody(
      `${COMPLIANT}\nhttps://claude.ai/code/session_017aiCyNj8HsA9DJBkaeoqot\n`,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join('\n')).toMatch(/agent-session link/);
  });

  it('refuses the Claude Code footer', () => {
    const verdict = judgePrBody(
      `${COMPLIANT}\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n`,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join('\n')).toMatch(/Generated with/);
  });

  it('refuses an empty, null, or non-string body — could-not-check is not a pass', () => {
    for (const body of ['', '   \n', null, undefined, 42]) {
      const verdict = judgePrBody(body);
      expect(verdict.ok, String(body)).toBe(false);
      expect(verdict.problems.join('\n')).toMatch(/empty or unreadable/);
    }
  });

  it('names every problem, not just the first', () => {
    const verdict = judgePrBody(
      '## Summary\n\n🤖 Generated with Claude Code\nhttps://claude.ai/code/session_x\n',
    );
    expect(verdict.problems).toHaveLength(3);
  });
});

describe('judgePrBody — what the rule asks for', () => {
  it('accepts a body that opens with `## Background` and carries no link', () => {
    expect(judgePrBody(COMPLIANT)).toEqual({ ok: true, problems: [] });
  });

  it('ignores headings inside fenced code and inside HTML comment blocks', () => {
    const body = [
      '<!--',
      '## Background',
      '-->',
      '```',
      '### not a heading',
      '```',
      '## Background',
      '',
      'x',
    ].join('\n');
    expect(firstHeading(body)).toBe('## Background');
    expect(judgePrBody(body).ok).toBe(true);
    // The commented-out heading must not satisfy the floor on its own.
    const commentedOnly = '<!--\n## Background\n-->\n### Accepted recommendation\n\nx\n';
    expect(firstHeading(commentedOnly)).toBe('### Accepted recommendation');
    expect(judgePrBody(commentedOnly).ok).toBe(false);
  });

  it('does not refuse ordinary prose that says "generated with"', () => {
    // The footer pattern is the Claude Code footer, not the two words.
    expect(judgePrBody(`${COMPLIANT}\nThe declaration file is generated with tsc.\n`).ok).toBe(
      true,
    );
  });
});

describe('the template can never contradict the floor', () => {
  it("feeds .github/PULL_REQUEST_TEMPLATE.md's own first heading to the judge", () => {
    const template = readFileSync(
      path.join(WORKSPACE_ROOT, '.github/PULL_REQUEST_TEMPLATE.md'),
      'utf8',
    );
    expect(firstHeading(template)).toBe('## Background');
    // Both halves bind: the template's first heading must satisfy the floor, and no prompt in it may
    // spell the forbidden strings.
    expect(judgePrBody(template)).toEqual({ ok: true, problems: [] });
  });

  it('has no duplicate lowercase template beside it', () => {
    // Listed by exact name: on a case-insensitive filesystem a read of the lowercase path would
    // succeed against PULL_REQUEST_TEMPLATE.md and this case would go red for the wrong reason.
    expect(readdirSync(path.join(WORKSPACE_ROOT, '.github'))).not.toContain(
      'pull_request_template.md',
    );
  });
});

describe('the script exit code is the verdict', () => {
  function run(body) {
    const env = { ...process.env, PR_BODY: body };
    delete env.GITHUB_STEP_SUMMARY;
    const result = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  it('exits 1 with ::error:: lines on a refused body', () => {
    const result = run('### Accepted recommendation\n');
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/::error::the PR body's first heading/);
  });

  it('exits 0 on a compliant body', () => {
    const result = run(COMPLIANT);
    expect(result.status, result.output).toBe(0);
  });

  it('exits 1 on an empty body passed through the environment', () => {
    expect(run('').status).toBe(1);
  });
});
