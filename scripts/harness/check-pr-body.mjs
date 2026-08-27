#!/usr/bin/env node
/**
 * RULE-016 (issue #2403) — a pull request body opens with what was broken and for whom, and carries no
 * agent-session link.
 *
 * ## What this judges, and what it does not
 *
 * `.agents/rules/backlog-execution.md` § PR Unit Rule owns the PR body: seven ordered sections, the
 * first of them `## Background`, and a prohibition on agent-session links and "Generated with …"
 * footers. This judge mechanises the two halves a machine can decide without reading prose:
 *
 *   - the FIRST heading line of the body (outside fenced code) is exactly `## Background` — a
 *     positional test, because "opens with" is the rule; a `## Background` that appears after
 *     `### Accepted recommendation` is the rejected body with one heading added;
 *   - the body carries no `claude.ai/code/session…` link and no Claude Code footer.
 *
 * The order of the later sections is prose-owned and is not judged here; the rule's `Enforced by:`
 * line says so, so the floor does not over-claim.
 *
 * ## Why a script and not a regex in YAML
 *
 * `review-gate.yml` runs this from the BASE revision, after its `ref: base.sha` checkout — the same
 * trust design as the other decision modules that job loads: PR-controlled code never judges the PR.
 * A script has its own refuse/accept cases, and one case feeds the repository's own
 * `.github/PULL_REQUEST_TEMPLATE.md` to it, so the template can never contradict the floor.
 *
 * ## Fail-closed
 *
 * An empty or non-string body is a refusal, not a pass. "Could not read the body" and "the body is
 * fine" must not share an output (`.agents/rules/enforcement-architecture.md` § Silence is not
 * success).
 *
 * Usage (CI): `PR_BODY="${{ github.event.pull_request.body }}" node scripts/harness/check-pr-body.mjs`
 * Usage (local): `gh pr view <n> --json body -q .body | node scripts/harness/check-pr-body.mjs`
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const REQUIRED_FIRST_HEADING = '## Background';
export const SESSION_LINK = /claude\.ai\/code\/session/;
export const CLAUDE_CODE_FOOTER = /Generated with .*Claude Code|🤖 Generated with/;

/**
 * The first markdown heading line of `body`, ignoring fenced code blocks, or null when there is none.
 */
export function firstHeading(body) {
  let inFence = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^#{1,6}\s/.test(line)) return line;
  }
  return null;
}

/**
 * @param {unknown} body the pull request body as GitHub reports it (`null` for an empty one)
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function judgePrBody(body) {
  if (typeof body !== 'string' || body.trim() === '') {
    return {
      ok: false,
      problems: [
        'the PR body is empty or unreadable — a body that cannot be judged is not a body that passed',
      ],
    };
  }
  const problems = [];
  const heading = firstHeading(body);
  if (heading === null) {
    problems.push(`the PR body has no heading; it must open with \`${REQUIRED_FIRST_HEADING}\``);
  } else if (heading !== REQUIRED_FIRST_HEADING) {
    problems.push(
      `the PR body's first heading is \`${heading}\`; it must be \`${REQUIRED_FIRST_HEADING}\` — ` +
        'what is broken, who is affected, and why it matters, before anything else',
    );
  }
  if (SESSION_LINK.test(body)) {
    problems.push('the PR body carries an agent-session link (claude.ai/code/session…); remove it');
  }
  if (CLAUDE_CODE_FOOTER.test(body)) {
    problems.push('the PR body carries a "Generated with … Claude Code" footer; remove it');
  }
  return { ok: problems.length === 0, problems };
}

function readBody() {
  if (process.env.PR_BODY !== undefined) return process.env.PR_BODY;
  // The documented local invocation pipes `gh pr view … -q .body` in. A terminal with nothing
  // piped is an empty body, which the judge refuses — no read path reads as a pass.
  return process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
}

export function main() {
  const verdict = judgePrBody(readBody());
  const summary = verdict.ok
    ? ['## PR body', '', 'PASS — opens with `## Background`, carries no agent-session link.']
    : [
        '## PR body',
        '',
        'BLOCKED — `.agents/rules/backlog-execution.md` § PR Unit Rule:',
        '',
        ...verdict.problems.map((p) => `- ${p}`),
      ];
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`);
  }
  if (verdict.ok) {
    console.log('check-pr-body: PASS');
    return 0;
  }
  for (const problem of verdict.problems) console.error(`::error::${problem}`);
  console.error(
    'check-pr-body: BLOCKED — fix the body with `gh pr edit <n> --body-file …` (no push needed).',
  );
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
