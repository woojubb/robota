import { describe, expect, it } from 'vitest';

import {
  groupCommits,
  parseConventional,
  renderNotes,
  updateChangelog,
} from '../generate-release-notes.mjs';

const REPO_URL = 'https://github.com/woojubb/robota';

/** Build a minimal raw-commit record (single parent = non-merge). */
function commit(subject, parents = ['p1']) {
  return { hash: 'h-' + subject.slice(0, 12), parents, subject };
}

describe('parseConventional', () => {
  it('parses a scoped subject with a trailing PR number', () => {
    expect(parseConventional('feat(hooks): honor inline branch-guard overrides (#1287)')).toEqual({
      type: 'feat',
      scope: 'hooks',
      breaking: false,
      description: 'honor inline branch-guard overrides',
      pr: 1287,
    });
  });

  it('parses an unscoped subject without a PR number', () => {
    expect(parseConventional('fix: correct off-by-one in pager')).toEqual({
      type: 'fix',
      scope: null,
      breaking: false,
      description: 'correct off-by-one in pager',
      pr: null,
    });
  });

  it('parses the breaking-change marker (!)', () => {
    const parsed = parseConventional('feat(api)!: drop the legacy transport (#900)');
    expect(parsed).not.toBeNull();
    expect(parsed.breaking).toBe(true);
    expect(parsed.type).toBe('feat');
    expect(parsed.scope).toBe('api');
    expect(parsed.pr).toBe(900);
  });

  it('parses an unscoped breaking marker', () => {
    const parsed = parseConventional('refactor!: remove deprecated exports');
    expect(parsed).not.toBeNull();
    expect(parsed.breaking).toBe(true);
    expect(parsed.scope).toBeNull();
  });

  it('returns null for merge-commit subjects', () => {
    expect(parseConventional('Merge pull request #1166 from woojubb/develop')).toBeNull();
  });

  it('returns null for non-conventional subjects', () => {
    expect(parseConventional('update stuff quickly')).toBeNull();
  });
});

describe('groupCommits', () => {
  it('routes feat/fix/perf to their groups', () => {
    const groups = groupCommits([
      commit('feat(cli): add /workflows create (#1101)'),
      commit('fix(core): guard null session (#1102)'),
      commit('perf(dag): memoize node lookups (#1103)'),
    ]);
    expect(groups.features).toHaveLength(1);
    expect(groups.fixes).toHaveLength(1);
    expect(groups.performance).toHaveLength(1);
    expect(groups.security).toHaveLength(0);
    expect(groups.internal).toHaveLength(0);
  });

  it('excludes merge commits even when the subject looks conventional', () => {
    const groups = groupCommits([
      commit('feat(cli): sneaky merge subject (#1)', ['p1', 'p2']),
      commit('Merge pull request #1166 from woojubb/develop', ['p1', 'p2']),
    ]);
    expect(groups.features).toHaveLength(0);
    expect(groups.internal).toHaveLength(0);
  });

  it('excludes release promotion commits', () => {
    const groups = groupCommits([commit('release: v3.0.0-beta.80 (#1300)')]);
    expect(groups.features).toHaveLength(0);
    expect(groups.fixes).toHaveLength(0);
    expect(groups.internal).toHaveLength(0);
  });

  it('classifies deps/security-scoped fixes and chores as security', () => {
    const groups = groupCommits([
      commit('fix(deps): bound override ranges to their major (#1284)'),
      commit('chore(security): weekly osv-scanner over the lockfile (#1304)'),
      commit('fix(session): resolve CVE-2024-1234 in history loader (#1290)'),
      commit('chore(ci): apply GH Actions advisory bumps (#1313)'),
    ]);
    expect(groups.security).toHaveLength(4);
    expect(groups.fixes).toHaveLength(0);
    expect(groups.internal).toHaveLength(0);
  });

  it('keeps a plain fix out of the security group', () => {
    const groups = groupCommits([commit('fix(tui): keep cursor visible on resize (#1200)')]);
    expect(groups.fixes).toHaveLength(1);
    expect(groups.security).toHaveLength(0);
  });

  it('routes chore/refactor/docs/ci/test/build/style to internal', () => {
    const groups = groupCommits([
      commit('chore(backlog): archive done items (#1)'),
      commit('refactor(core): split runner (#2)'),
      commit('docs: refresh architecture map (#3)'),
      commit('ci: parallelize scans (#4)'),
      commit('test(cli): cover pager edge (#5)'),
      commit('build: bump tsdown (#6)'),
      commit('style: reformat imports (#7)'),
    ]);
    expect(groups.internal).toHaveLength(7);
  });

  it('routes unparseable non-merge subjects to internal as raw lines', () => {
    const groups = groupCommits([commit('update stuff quickly')]);
    expect(groups.internal).toHaveLength(1);
    expect(groups.internal[0].description).toBe('update stuff quickly');
  });

  it('dedupes repeated subjects that differ only by PR number (dependabot-style)', () => {
    const groups = groupCommits([
      commit('chore(deps): bump minimatch from 3.0.4 to 3.1.2 (#1284)'),
      commit('chore(deps): bump minimatch from 3.0.4 to 3.1.2 (#1120)'),
    ]);
    expect(groups.security).toHaveLength(1);
    expect(groups.security[0].pr).toBe(1284);
  });
});

describe('renderNotes', () => {
  const groups = groupCommits([
    commit('feat(cli)!: replace the session store (#1101)'),
    commit('feat: add compare links (#1102)'),
    commit('fix(core): guard null session (#1103)'),
    commit('perf(dag): memoize node lookups (#1104)'),
    commit('fix(deps): patch advisory in vite (#1105)'),
    commit('chore(backlog): archive done items (#1106)'),
  ]);

  it('renders the group headings in order with PR links and a compare link', () => {
    const md = renderNotes({
      groups,
      repoUrl: REPO_URL,
      ref: 'v9.9.9',
      prevRef: 'v9.9.8',
      date: '2026-07-24',
      headingLevel: 2,
    });
    const featIdx = md.indexOf('## 🚀 Features');
    const fixIdx = md.indexOf('## 🐛 Fixes');
    const perfIdx = md.indexOf('## ⚡ Performance');
    const secIdx = md.indexOf('## 🔒 Security');
    const internalIdx = md.indexOf('<summary>🏗 Internal</summary>');
    expect(featIdx).toBeGreaterThanOrEqual(0);
    expect(fixIdx).toBeGreaterThan(featIdx);
    expect(perfIdx).toBeGreaterThan(fixIdx);
    expect(secIdx).toBeGreaterThan(perfIdx);
    expect(internalIdx).toBeGreaterThan(secIdx);
    expect(md).toContain('<details>');
    expect(md).toContain(`[#1103](${REPO_URL}/pull/1103)`);
    expect(md).toContain(`${REPO_URL}/compare/v9.9.8...v9.9.9`);
    expect(md).toContain('**BREAKING**');
  });

  it('omits empty groups', () => {
    const md = renderNotes({
      groups: groupCommits([commit('feat: only a feature (#1)')]),
      repoUrl: REPO_URL,
      ref: 'v9.9.9',
      prevRef: 'v9.9.8',
      date: '2026-07-24',
      headingLevel: 2,
    });
    expect(md).toContain('## 🚀 Features');
    expect(md).not.toContain('## 🐛 Fixes');
    expect(md).not.toContain('## ⚡ Performance');
    expect(md).not.toContain('## 🔒 Security');
    expect(md).not.toContain('<details>');
  });

  it('demotes group headings when headingLevel is 3 (changelog nesting)', () => {
    const md = renderNotes({
      groups: groupCommits([commit('feat: nested heading (#1)')]),
      repoUrl: REPO_URL,
      ref: 'v9.9.9',
      prevRef: 'v9.9.8',
      date: '2026-07-24',
      headingLevel: 3,
    });
    expect(md).toContain('### 🚀 Features');
    expect(md).not.toContain('\n## 🚀 Features');
  });

  it('omits the compare link when there is no previous ref', () => {
    const md = renderNotes({
      groups: groupCommits([commit('feat: first ever (#1)')]),
      repoUrl: REPO_URL,
      ref: 'v0.0.1',
      prevRef: null,
      date: '2026-07-24',
      headingLevel: 2,
    });
    expect(md).not.toContain('/compare/');
  });
});

describe('updateChangelog', () => {
  const section = (key) =>
    `## ${key} (2026-07-24)\n\n### 🚀 Features\n\n- sample entry for ${key}\n`;

  it('creates the changelog with a header when there is no existing content', () => {
    const out = updateChangelog(null, { key: 'v9.9.9', section: section('v9.9.9') });
    expect(out.startsWith('# Changelog')).toBe(true);
    expect(out).toContain('sample entry for v9.9.9');
    expect(out).toContain('generated-release-notes:start v9.9.9');
    expect(out).toContain('generated-release-notes:end v9.9.9');
  });

  it('prepends a generated block above the first existing section, keeping the header', () => {
    const existing = '# Changelog\n\nIntro prose.\n\n## [3.0.0-beta] — in progress\n\n- old\n';
    const out = updateChangelog(existing, { key: 'v9.9.9', section: section('v9.9.9') });
    expect(out.indexOf('Intro prose.')).toBeLessThan(out.indexOf('v9.9.9'));
    expect(out.indexOf('sample entry for v9.9.9')).toBeLessThan(
      out.indexOf('## [3.0.0-beta] — in progress'),
    );
  });

  it('is idempotent: re-writing the same key replaces the block instead of duplicating it', () => {
    const existing = '# Changelog\n\n## [3.0.0-beta] — in progress\n\n- old\n';
    const once = updateChangelog(existing, { key: 'v9.9.9', section: section('v9.9.9') });
    const twice = updateChangelog(once, {
      key: 'v9.9.9',
      section: '## v9.9.9 (2026-07-25)\n\n- replaced entry\n',
    });
    expect(twice.match(/generated-release-notes:start v9\.9\.9/g)).toHaveLength(1);
    expect(twice).toContain('- replaced entry');
    expect(twice).not.toContain('sample entry for v9.9.9');
    // The untouched section survives.
    expect(twice).toContain('## [3.0.0-beta] — in progress');
  });

  it('stacks blocks newest-first: a later Unreleased insert lands above the tag block', () => {
    const existing = '# Changelog\n\n## [3.0.0-beta] — in progress\n\n- old\n';
    const withTag = updateChangelog(existing, { key: 'v9.9.9', section: section('v9.9.9') });
    const withUnreleased = updateChangelog(withTag, {
      key: 'unreleased',
      section: section('Unreleased'),
    });
    const unreleasedIdx = withUnreleased.indexOf('generated-release-notes:start unreleased');
    const tagIdx = withUnreleased.indexOf('generated-release-notes:start v9.9.9');
    expect(unreleasedIdx).toBeGreaterThanOrEqual(0);
    expect(unreleasedIdx).toBeLessThan(tagIdx);
    expect(tagIdx).toBeLessThan(withUnreleased.indexOf('## [3.0.0-beta] — in progress'));
  });
});
