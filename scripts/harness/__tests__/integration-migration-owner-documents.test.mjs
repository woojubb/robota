/**
 * MANIFEST-2664 / VERIFIER-2664 TC-04 — the migration rule has exactly one owner.
 *
 * `git-branch.md` § Branch Policy states the rule (strict replay by default; a closed divergence
 * manifest under `.agents/evidence/migrations/`, verified by `integration-migration-manifest.mjs`, for
 * every named difference); `backlog-execution.md` § Base Branch Workflow and the
 * `multi-backlog-initiative` skill's step 1 point at it. The equality wording is asserted with
 * spelling-normalised patterns because the repository carried both `stable patch IDs` and
 * `stable patch-ID` before this test existed; a positive match inside the owner section is required
 * so the negative sweep cannot pass vacuously.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const GIT_BRANCH = path.join(ROOT, '.agents/rules/git-branch.md');
const SKILL = path.join(ROOT, '.agents/skills/multi-backlog-initiative/SKILL.md');

const PATCH_ID = /stable\s+patch[\s-]?ids?/gi;
const CHANGED_PATH = /changed-path (equality|equivalence)/gi;

function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return null;
  const level = /^#+/.exec(heading)[0].length;
  const end = lines.findIndex(
    (line, index) => index > start && /^#+\s/.test(line) && /^#+/.exec(line)[0].length <= level,
  );
  return lines.slice(start + 1, end < 0 ? lines.length : end).join('\n');
}

function markdownFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
  }
  return files.sort();
}

function count(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

describe('integration-migration owner documents (TC-04)', () => {
  const gitBranch = readFileSync(GIT_BRANCH, 'utf8');
  const policy = section(gitBranch, '### Branch Policy');

  it('git-branch.md § Branch Policy owns the migration sentence and names the evidence directory', () => {
    expect(policy).not.toBeNull();
    // Prettier wraps the rule prose, so phrases are matched over whitespace-normalised text.
    const prose = policy.replace(/\s+/g, ' ');
    expect(prose).toContain('.agents/evidence/migrations/');
    expect(prose).toContain('integration-migration-manifest.mjs verify');
    expect(prose).toMatch(/merge own-content verification is added by the bundle that lands it/);
    expect(prose).toMatch(/manual waiver is not a manifest/);
    expect(prose).toMatch(/legacy ref stays immutable/);
    expect(prose).toMatch(/Enforced by:/);
    // Positive control: the strict-equality default is stated in the owner section itself.
    expect(count(policy, PATCH_ID)).toBeGreaterThanOrEqual(1);
    expect(count(policy, CHANGED_PATH)).toBeGreaterThanOrEqual(1);
  });

  it('the initiative skill links to the branch-policy owner without restating it', () => {
    const skill = readFileSync(SKILL, 'utf8');
    expect(skill).toMatch(
      /\[`git-branch\.md` § Branch Policy\]\(\.\.\/\.\.\/rules\/git-branch\.md#branch-policy\)/,
    );
    expect(count(skill, PATCH_ID)).toBe(0);
    expect(count(skill, CHANGED_PATH)).toBe(0);
  });

  it('no other file under .agents/rules or .agents/skills states the equality policy', () => {
    const files = [
      ...markdownFiles(path.join(ROOT, '.agents/rules')),
      ...markdownFiles(path.join(ROOT, '.agents/skills')),
    ];
    const offenders = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const body = file === GIT_BRANCH ? text.replace(policy, '') : text;
      const hits = count(body, PATCH_ID) + count(body, CHANGED_PATH);
      if (hits > 0) offenders.push(`${path.relative(ROOT, file)} (${hits})`);
    }
    expect(offenders).toEqual([]);
  });
});
