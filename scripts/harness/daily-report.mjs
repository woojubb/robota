#!/usr/bin/env node

/**
 * OBSERVABILITY-001: daily work-report harness.
 *
 * Generates a per-UTC-day markdown work report from git history: one report per UTC day that HAS work
 * (commits), template-based, skipping no-work days, catching up day-by-day from the last report. The
 * report's factual sections (commits, merged PRs, files/specs/tasks touched) are filled deterministically
 * here; a "## Summary" section is left for an agent to author (see the `daily-report` skill).
 *
 * Pure functions are exported for testing (git access is injected via `runGit`). The CLI writes reports.
 *
 * Usage:
 *   node scripts/harness/daily-report.mjs --plan                 # JSON of work days needing a report
 *   node scripts/harness/daily-report.mjs                        # write reports for all work days needing one
 *   node scripts/harness/daily-report.mjs --date 2026-07-18      # write one report (a specific UTC day)
 *   node scripts/harness/daily-report.mjs --force                # overwrite existing reports
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
export const REPORTS_DIR = '.agents/daily-reports';
const REPORT_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;
const UNIT_SEP = String.fromCharCode(31); // ASCII unit separator — never in commit subjects/authors
const MS_PER_DAY = 86_400_000;

/** Default git runner — returns stdout as a string. Injected in tests. */
export function defaultRunGit(args) {
  return execFileSync('git', args, {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** UTC `YYYY-MM-DD` for a Date. */
export function utcDateString(date) {
  return date.toISOString().slice(0, 10);
}

/** The most recent UTC date already reported (from existing `YYYY-MM-DD.md` files), or null. */
export function lastReportedDate(root = WORKSPACE_ROOT) {
  const dir = path.join(root, REPORTS_DIR);
  if (!existsSync(dir)) return null;
  const dates = readdirSync(dir)
    .map((name) => REPORT_FILE_RE.exec(name)?.[1])
    .filter((value) => value !== undefined)
    .sort();
  return dates.length > 0 ? dates[dates.length - 1] : null;
}

/** Every UTC date string strictly after `afterDate` up to and including `throughDate`. */
export function datesAfter(afterDate, throughDate) {
  const out = [];
  const through = Date.parse(`${throughDate}T00:00:00Z`);
  let cursor = afterDate ? Date.parse(`${afterDate}T00:00:00Z`) + MS_PER_DAY : through;
  while (cursor <= through) {
    out.push(utcDateString(new Date(cursor)));
    cursor += MS_PER_DAY;
  }
  return out;
}

/**
 * All commits since `sinceDate` (a coarse git filter), each tagged with its UTC day (computed in JS
 * from the committer ISO date, so the day boundary is UTC-exact regardless of git's tz handling).
 */
export function commitsSince(sinceDate, runGit = defaultRunGit) {
  const format = ['%H', '%cI', '%s', '%an'].join(UNIT_SEP);
  const args = ['log', `--pretty=${format}`];
  if (sinceDate) args.push('--since', `${sinceDate}T00:00:00Z`);
  const out = runGit(args).trim();
  if (!out) return [];
  return out.split('\n').map((line) => {
    const [hash, committedIso, subject, author] = line.split(UNIT_SEP);
    return { hash, utcDay: committedIso.slice(0, 10), subject, author };
  });
}

/** File paths changed by one commit. */
export function filesForCommit(hash, runGit = defaultRunGit) {
  const out = runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', hash]).trim();
  return out ? out.split('\n') : [];
}

const prNumberOf = (subject) => /\(#(\d+)\)\s*$/.exec(subject)?.[1];

/** Gather the structured factual data for one UTC day from its commits. */
export function gatherDayData(utcDay, commits, runGit = defaultRunGit) {
  const dayCommits = commits.filter((commit) => commit.utcDay === utcDay);
  const files = new Set();
  for (const commit of dayCommits) {
    for (const file of filesForCommit(commit.hash, runGit)) files.add(file);
  }
  const allFiles = [...files].sort();
  return {
    date: utcDay,
    commits: dayCommits.map((c) => ({
      hash: c.hash.slice(0, 7),
      subject: c.subject,
      author: c.author,
    })),
    mergedPrs: dayCommits
      .map((c) => ({ number: prNumberOf(c.subject), subject: c.subject }))
      .filter((pr) => pr.number !== undefined),
    files: allFiles,
    specs: allFiles.filter((f) => f.startsWith('.agents/spec-docs/')),
    tasks: allFiles.filter((f) => f.startsWith('.agents/tasks/')),
  };
}

/** The UTC work days (with commits) that still need a report: after the last report, through `throughDate`. */
export function workDaysNeedingReport(
  throughDate,
  { root = WORKSPACE_ROOT, runGit = defaultRunGit } = {},
) {
  const last = lastReportedDate(root);
  const candidateDates = new Set(datesAfter(last, throughDate));
  const commits = commitsSince(last, runGit);
  const workDays = new Set(commits.map((commit) => commit.utcDay));
  return [...candidateDates].filter((date) => workDays.has(date)).sort();
}

/** Render the report markdown from the gathered day data. The `## Summary` is left for an agent. */
export function renderReport(data) {
  const lines = [
    `# Daily Work Report — ${data.date} (UTC)`,
    '',
    `**UTC window:** ${data.date}T00:00:00Z → ${data.date}T23:59:59Z`,
    `**Commits:** ${data.commits.length}  ·  **Merged PRs:** ${data.mergedPrs.length}  ·  **Files touched:** ${data.files.length}`,
    '',
    '## Summary',
    '',
    '<!-- agent: replace this with a 1–3 sentence prose summary of what was accomplished this UTC day. -->',
    '_(pending agent summary)_',
    '',
    '## Merged PRs',
    '',
    ...(data.mergedPrs.length > 0
      ? data.mergedPrs.map((pr) => `- #${pr.number} — ${pr.subject.replace(/\s*\(#\d+\)\s*$/, '')}`)
      : ['_none_']),
    '',
    '## Commits',
    '',
    ...(data.commits.length > 0
      ? data.commits.map((c) => `- \`${c.hash}\` ${c.subject} — ${c.author}`)
      : ['_none_']),
    '',
    '## Specs / tasks advanced',
    '',
    ...(data.specs.length + data.tasks.length > 0
      ? [...data.specs, ...data.tasks].map((f) => `- \`${f}\``)
      : ['_none_']),
    '',
    '---',
    '',
    '_Generated by the daily-report harness (OBSERVABILITY-001) from git history; the Summary is agent-authored._',
    '',
  ];
  return lines.join('\n');
}

function writeReport(data, { root = WORKSPACE_ROOT, force = false } = {}) {
  const dir = path.join(root, REPORTS_DIR);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${data.date}.md`);
  if (existsSync(file) && !force) return { written: false, file };
  writeFileSync(file, renderReport(data), 'utf8');
  return { written: true, file };
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => argv.includes(name);
  const valueOf = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const force = flag('--force');
  const explicitDate = valueOf('--date');
  const through = explicitDate ?? utcDateString(new Date(Date.now()));

  const days = explicitDate ? [explicitDate] : workDaysNeedingReport(through);
  const commits = commitsSince(lastReportedDate(), defaultRunGit);
  const reports = days.map((day) => gatherDayData(day, commits, defaultRunGit));

  if (flag('--plan')) {
    process.stdout.write(`${JSON.stringify({ workDays: reports }, null, 2)}\n`);
    return;
  }
  if (reports.length === 0) {
    process.stdout.write('daily-report: no work days need a report.\n');
    return;
  }
  for (const data of reports) {
    const { written, file } = writeReport(data, { force });
    process.stdout.write(`${written ? 'wrote' : 'skipped (exists)'}: ${file}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
