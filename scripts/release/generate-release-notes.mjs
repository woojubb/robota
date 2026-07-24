#!/usr/bin/env node
/**
 * REL-022 — managed release notes generator.
 *
 * Turns the conventional-commit history of a git range into curated release
 * notes: grouped Features / Fixes / Performance / Security sections plus a
 * collapsed Internal section, with PR links and a compare link. Replaces
 * `gh release create --generate-notes` (raw, uncategorized PR-title dumps)
 * in the two v* tag release workflows, and maintains generated sections in
 * the root CHANGELOG.md.
 *
 * Pure core (exported, no I/O): parseConventional, groupCommits, renderNotes,
 * updateChangelog. Git access is confined to the CLI layer. NO network.
 *
 * Usage:
 *   node scripts/release/generate-release-notes.mjs [options]
 *
 * Options:
 *   --tag <tag>          Target ref/tag (default: Unreleased mode over HEAD)
 *   --prev <tag>         Previous tag (default: auto-detect — nearest v* tag
 *                        reachable from <tag>^; falls back to the newest v*
 *                        tag by creation date, since historical v* tags are
 *                        not all ancestors of the current line)
 *   --unreleased         Render lastTag..HEAD as an "Unreleased" section
 *   --notes-file <path>  Write just the section body (for `gh release create --notes-file`)
 *   --write-changelog    Prepend/replace the section in the root CHANGELOG.md (idempotent)
 *   --changelog <path>   Changelog path override (default: <repo root>/CHANGELOG.md)
 *   --repo <url>         Repository URL override
 *
 * Without --notes-file/--write-changelog the rendered section is printed to stdout.
 *
 * NOTE: this is complementary to `.changeset/*.md`, which tracks npm-package-level
 * version bumps. This script owns GH-release/product-level notes only.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const DEFAULT_REPO_URL = 'https://github.com/woojubb/robota';

const GROUP_ORDER = [
  { key: 'features', title: '🚀 Features' },
  { key: 'fixes', title: '🐛 Fixes' },
  { key: 'performance', title: '⚡ Performance' },
  { key: 'security', title: '🔒 Security' },
];

const INTERNAL_TYPES = new Set(['chore', 'refactor', 'docs', 'ci', 'test', 'build', 'style']);
const SECURITY_SCOPES = new Set(['deps', 'security']);
const SECURITY_SUBJECT_RE = /advisory|vulnerab|osv|cve/i;
const CONVENTIONAL_RE = /^([a-zA-Z]+)(?:\(([^)]*)\))?(!)?:\s+(.*)$/;
const PR_SUFFIX_RE = /\s*\(#(\d+)\)\s*$/;

/**
 * Parse one conventional-commit subject line.
 *
 * @param {string} subject
 * @returns {{ type: string, scope: string | null, breaking: boolean, description: string, pr: number | null } | null}
 *   null when the subject is not conventional (includes merge-commit subjects).
 */
export function parseConventional(subject) {
  const match = CONVENTIONAL_RE.exec(subject.trim());
  if (!match) return null;
  const [, type, scope, bang, rest] = match;
  const prMatch = PR_SUFFIX_RE.exec(rest);
  const description = rest.replace(PR_SUFFIX_RE, '').trim();
  return {
    type: type.toLowerCase(),
    scope: scope ? scope.trim() : null,
    breaking: bang === '!',
    description,
    pr: prMatch ? Number(prMatch[1]) : null,
  };
}

/**
 * @param {{ type: string, scope: string | null, description: string }} parsed
 * @returns {boolean} true when the commit is security-relevant (deps/security
 *   scoped fix/chore, or an advisory/vulnerability/OSV/CVE subject).
 */
function isSecurity(parsed) {
  if (parsed.type !== 'fix' && parsed.type !== 'chore') return false;
  if (parsed.scope !== null && SECURITY_SCOPES.has(parsed.scope.toLowerCase())) return true;
  return SECURITY_SUBJECT_RE.test(parsed.description);
}

/**
 * Group raw commits into release-note sections.
 *
 * Exclusions: merge commits (2+ parents or a "Merge " subject), `release:`
 * promotion commits, and duplicate subjects that differ only by PR number
 * (dependabot-style re-runs; the first — newest — occurrence wins, assuming
 * newest-first input as produced by `git log`).
 *
 * @param {Array<{ hash: string, parents: string[], subject: string }>} commits newest-first
 * @returns {{ features: object[], fixes: object[], performance: object[], security: object[], internal: object[] }}
 */
export function groupCommits(commits) {
  const groups = { features: [], fixes: [], performance: [], security: [], internal: [] };
  const seen = new Set();

  for (const raw of commits) {
    if (raw.parents.length > 1) continue;
    if (/^Merge\s/.test(raw.subject)) continue;

    const parsed = parseConventional(raw.subject);
    const entry = parsed ?? {
      type: null,
      scope: null,
      breaking: false,
      description: raw.subject.trim(),
      pr: null,
    };

    if (entry.type === 'release') continue;

    const dedupeKey = `${entry.type ?? ''}|${entry.scope ?? ''}|${entry.description.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    if (parsed === null) {
      groups.internal.push(entry);
    } else if (isSecurity(entry)) {
      groups.security.push(entry);
    } else if (entry.type === 'feat') {
      groups.features.push(entry);
    } else if (entry.type === 'fix') {
      groups.fixes.push(entry);
    } else if (entry.type === 'perf') {
      groups.performance.push(entry);
    } else if (INTERNAL_TYPES.has(entry.type)) {
      groups.internal.push(entry);
    } else {
      // Unlisted conventional types (e.g. revert) are still real changes;
      // surface them in the collapsed Internal section rather than dropping them.
      groups.internal.push(entry);
    }
  }

  return groups;
}

/**
 * @param {{ scope: string | null, breaking: boolean, description: string, pr: number | null }} entry
 * @param {string} repoUrl
 * @returns {string} one markdown bullet line
 */
function renderLine(entry, repoUrl) {
  const scopePrefix = entry.scope ? `**${entry.scope}**: ` : '';
  const breaking = entry.breaking ? ' **BREAKING**' : '';
  const prLink = entry.pr === null ? '' : ` ([#${entry.pr}](${repoUrl}/pull/${entry.pr}))`;
  return `- ${scopePrefix}${entry.description}${breaking}${prLink}`;
}

/**
 * Render the notes body for one range: compare link + grouped sections +
 * collapsed Internal. Does NOT include the `## <tag>` heading — callers add
 * it for the changelog (GH releases already title the release with the tag).
 *
 * @param {{
 *   groups: ReturnType<typeof groupCommits>,
 *   repoUrl: string,
 *   ref: string,
 *   prevRef: string | null,
 *   date: string,
 *   headingLevel: number,
 * }} input
 * @returns {string} markdown
 */
export function renderNotes({ groups, repoUrl, ref, prevRef, date, headingLevel }) {
  const h = '#'.repeat(headingLevel);
  const parts = [];

  if (prevRef !== null) {
    parts.push(
      `**${date}** · [Full changelog: ${prevRef}...${ref}](${repoUrl}/compare/${prevRef}...${ref})`,
    );
  } else {
    parts.push(`**${date}**`);
  }

  for (const { key, title } of GROUP_ORDER) {
    const entries = groups[key];
    if (entries.length === 0) continue;
    parts.push(`${h} ${title}\n\n${entries.map((e) => renderLine(e, repoUrl)).join('\n')}`);
  }

  if (groups.internal.length > 0) {
    parts.push(
      [
        '<details>',
        '<summary>🏗 Internal</summary>',
        '',
        groups.internal.map((e) => renderLine(e, repoUrl)).join('\n'),
        '',
        '</details>',
      ].join('\n'),
    );
  }

  if (parts.length === 1) {
    parts.push('_No changes in this range._');
  }

  return parts.join('\n\n') + '\n';
}

const CHANGELOG_HEADER = `# Changelog

All notable changes to this project will be documented in this file.
Sections between \`generated-release-notes\` markers are produced by
\`scripts/release/generate-release-notes.mjs\` — regenerate them, do not edit by hand.
`;

const startMarker = (key) => `<!-- generated-release-notes:start ${key} -->`;
const endMarker = (key) => `<!-- generated-release-notes:end ${key} -->`;

/**
 * Insert or replace one generated section in the changelog. Idempotent: an
 * existing block for the same key is replaced in place; a new block is
 * inserted above the first generated block or first `## ` section (i.e.
 * newest-first), after any intro header prose.
 *
 * @param {string | null} existing current changelog content (null when the file is missing)
 * @param {{ key: string, section: string }} input key = tag or 'unreleased'
 * @returns {string} new changelog content
 */
export function updateChangelog(existing, { key, section }) {
  const block = `${startMarker(key)}\n${section.trimEnd()}\n${endMarker(key)}\n`;

  if (existing === null || existing.trim() === '') {
    return `${CHANGELOG_HEADER}\n${block}`;
  }

  const start = existing.indexOf(startMarker(key));
  const end = existing.indexOf(endMarker(key));
  if (start !== -1 && end !== -1 && end > start) {
    const afterEnd = end + endMarker(key).length;
    const tail = existing.slice(afterEnd).replace(/^\n/, '');
    return existing.slice(0, start) + block + tail;
  }

  // Insert above the first generated block or the first `## ` section.
  const lines = existing.split('\n');
  let insertAt = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('<!-- generated-release-notes:start') || /^## /.test(lines[i])) {
      insertAt = i;
      break;
    }
  }
  const head = lines.slice(0, insertAt).join('\n').trimEnd();
  const tail = lines.slice(insertAt).join('\n');
  return `${head}\n\n${block}\n${tail}`;
}

// ─── CLI layer (git access lives here; the core above is pure) ──────────────

/**
 * @param {string[]} args
 * @param {{ cwd: string }} opts
 * @returns {string | null} trimmed stdout, or null when git exits non-zero
 */
function tryGit(args, { cwd }) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

/**
 * @param {string[]} args
 * @param {{ cwd: string }} opts
 * @returns {string} trimmed stdout; throws on failure
 */
function git(args, { cwd }) {
  const out = tryGit(args, { cwd });
  if (out === null) {
    throw new Error(`git ${args.join(' ')} failed`);
  }
  return out;
}

/**
 * Auto-detect the previous v* tag for a ref. Prefers the nearest v* tag
 * reachable from <ref>^; when none is reachable (this repo's older v* tags
 * are not ancestors of the current line), uses the newest v* tag by
 * creation date that is not the ref itself.
 *
 * @param {string} ref
 * @param {{ cwd: string }} opts
 * @returns {string | null}
 */
function detectPrevTag(ref, opts) {
  const described = tryGit(['describe', '--tags', '--abbrev=0', '--match', 'v*', `${ref}^`], opts);
  if (described !== null && described !== '') return described;

  const tags = git(['tag', '-l', 'v*', '--sort=-creatordate'], opts)
    .split('\n')
    .filter((t) => t !== '');
  const prev = tags.find((t) => t !== ref);
  return prev ?? null;
}

/**
 * @param {string} range
 * @param {{ cwd: string }} opts
 * @returns {Array<{ hash: string, parents: string[], subject: string }>} newest-first
 */
function readCommits(range, opts) {
  const raw = git(['log', '--format=%H%x1f%P%x1f%s', range], opts);
  if (raw === '') return [];
  return raw.split('\n').map((line) => {
    const [hash, parents, subject] = line.split('\x1f');
    return { hash, parents: parents === '' ? [] : parents.split(' '), subject };
  });
}

function main() {
  const { values } = parseArgs({
    options: {
      tag: { type: 'string' },
      prev: { type: 'string' },
      unreleased: { type: 'boolean', default: false },
      'notes-file': { type: 'string' },
      'write-changelog': { type: 'boolean', default: false },
      changelog: { type: 'string' },
      repo: { type: 'string' },
    },
  });

  const cwd = process.cwd();
  const repoRoot = git(['rev-parse', '--show-toplevel'], { cwd });
  const gitOpts = { cwd: repoRoot };
  const repoUrl = values.repo ?? DEFAULT_REPO_URL;

  const unreleased = values.unreleased || values.tag === undefined;
  const ref = unreleased ? 'HEAD' : values.tag;
  const title = unreleased ? 'Unreleased' : values.tag;
  const key = unreleased ? 'unreleased' : values.tag;

  if (tryGit(['rev-parse', '--verify', `${ref}^{commit}`], gitOpts) === null) {
    console.error(`error: ref not found: ${ref}`);
    process.exit(1);
  }

  const prevRef = values.prev ?? detectPrevTag(ref, gitOpts);
  const range = prevRef === null ? ref : `${prevRef}..${ref}`;
  const date = git(['log', '-1', '--format=%cs', ref], gitOpts);
  const groups = groupCommits(readCommits(range, gitOpts));
  // The compare link needs a pushable ref name; for Unreleased, HEAD is not
  // linkable on GitHub, so link prev...develop (the integration branch).
  const compareRef = unreleased ? 'develop' : ref;

  if (values['notes-file'] !== undefined) {
    const body = renderNotes({ groups, repoUrl, ref: compareRef, prevRef, date, headingLevel: 2 });
    writeFileSync(path.resolve(cwd, values['notes-file']), body);
    console.log(`wrote notes for ${title} (${range}) to ${values['notes-file']}`);
  }

  if (values['write-changelog']) {
    const changelogPath = values.changelog
      ? path.resolve(cwd, values.changelog)
      : path.join(repoRoot, 'CHANGELOG.md');
    const body = renderNotes({ groups, repoUrl, ref: compareRef, prevRef, date, headingLevel: 3 });
    const section = `## ${title} (${date})\n\n${body}`;
    const existing = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : null;
    writeFileSync(changelogPath, updateChangelog(existing, { key, section }));
    console.log(`updated ${changelogPath} section "${title}" (${range})`);
  }

  if (values['notes-file'] === undefined && !values['write-changelog']) {
    const body = renderNotes({ groups, repoUrl, ref: compareRef, prevRef, date, headingLevel: 2 });
    process.stdout.write(`## ${title} (${date})\n\n${body}`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Exit quietly when stdout is a closed pipe (e.g. `... | head`).
  process.stdout.on('error', (error) => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
  });
  main();
}
