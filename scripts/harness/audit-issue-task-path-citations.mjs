#!/usr/bin/env node

/** Read-only audit of Task-record paths in open issues and their cited source issues. */

import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import path from 'node:path';

import { fetchAllPages } from './github-api.mjs';
import { classifyCitation, indexRecords } from './task-path-citation.mjs';

const CITATION = /\.agents\/tasks\/[A-Za-z0-9._/-]+\.md/g;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9.-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ISSUE_REFERENCE = /(?:^|[^\w])#(\d+)\b/g;
const ISSUE_URL = /https:\/\/github\.com\/([A-Za-z0-9.-]+\/[A-Za-z0-9._-]+)\/issues\/(\d+)\b/gi;

function assertRepository(repo) {
  if (typeof repo !== 'string' || !REPOSITORY.test(repo) || repo.includes('..')) {
    throw new TypeError('usage: audit-issue-task-path-citations.mjs --repo <owner/name>');
  }
}

export function parseAuditArgs(argv) {
  if (argv.length !== 2 || argv[0] !== '--repo') {
    throw new TypeError('usage: audit-issue-task-path-citations.mjs --repo <owner/name>');
  }
  assertRepository(argv[1]);
  return { repo: argv[1] };
}

/** Extract prose citations; a fenced example is not a live issue-body claim. */
export function extractIssueTaskPaths(body) {
  const citations = [];
  let fence = null;
  for (const [index, line] of body.split(/\r?\n/).entries()) {
    const marker = FENCE.exec(line)?.[1];
    if (marker) {
      if (fence === null) fence = { character: marker[0], length: marker.length };
      else if (marker[0] === fence.character && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    for (const match of line.matchAll(CITATION)) {
      citations.push({ line: index + 1, cited: match[0] });
    }
  }
  return citations;
}

/** Validate every API issue before interpreting an empty or absent body as clean. */
export function auditIssueTaskPaths(issues, trackedFiles) {
  if (!Array.isArray(issues) || !Array.isArray(trackedFiles)) {
    throw new TypeError('issue Task-path audit requires issue and tracked-file arrays');
  }
  const known = new Set(trackedFiles);
  const index = indexRecords(trackedFiles);
  const findings = [];
  let examined = 0;
  let citations = 0;
  for (const issue of issues) {
    if (issue === null || typeof issue !== 'object' || Array.isArray(issue)) {
      throw new TypeError('issue Task-path audit received a malformed issue record');
    }
    if (Object.hasOwn(issue, 'pull_request')) continue;
    if (!Number.isSafeInteger(issue.number) || issue.number < 1) {
      throw new TypeError('issue Task-path audit received an invalid issue number');
    }
    if (typeof issue.title !== 'string' || !issue.title.trim()) {
      throw new TypeError(`issue #${issue.number} has no valid title`);
    }
    if (issue.body !== null && typeof issue.body !== 'string') {
      throw new TypeError(`issue #${issue.number} has no valid body`);
    }
    examined += 1;
    for (const citation of extractIssueTaskPaths(issue.body ?? '')) {
      citations += 1;
      const result = classifyCitation(citation.cited, index, (file) => known.has(file));
      if (result.outcome !== 'exact') {
        findings.push({ issueNumber: issue.number, ...citation, ...result });
      }
    }
  }
  return { examined, citations, findings };
}

/** Follow one explicit issue-reference edge from each open issue, not the whole historical graph. */
export function selectActiveIssueScope(records, repo) {
  assertRepository(repo);
  if (!Array.isArray(records)) throw new TypeError('issue Task-path audit requires an issue array');
  if (
    records.some((record) => record === null || typeof record !== 'object' || Array.isArray(record))
  ) {
    throw new TypeError('issue Task-path audit received a malformed issue record');
  }
  const issues = records.filter((record) => !Object.hasOwn(record, 'pull_request'));
  const cited = new Set();
  for (const record of issues) {
    if (!Number.isSafeInteger(record.number) || !['open', 'closed'].includes(record.state)) {
      throw new TypeError('issue Task-path audit received an invalid issue number or state');
    }
    if (record.state !== 'open') continue;
    if (record.body !== null && typeof record.body !== 'string') {
      throw new TypeError(`issue #${record.number} has no valid body`);
    }
    for (const match of (record.body ?? '').matchAll(ISSUE_REFERENCE)) cited.add(Number(match[1]));
    for (const match of (record.body ?? '').matchAll(ISSUE_URL)) {
      if (match[1].toLowerCase() === repo.toLowerCase()) cited.add(Number(match[2]));
    }
  }
  return issues.filter((record) => record.state === 'open' || cited.has(record.number));
}

export function findingSeverity(outcome) {
  if (outcome === 'dangling' || outcome === 'conflict') return 'error';
  if (outcome === 'moved' || outcome === 'archived' || outcome === 'renamed') return 'warning';
  throw new TypeError(`unknown Task-path outcome: ${outcome}`);
}

export function readAllIssues(repo, options = {}) {
  assertRepository(repo);
  return fetchAllPages(`repos/${repo}/issues?state=all`, options).records;
}

/** Only tracked, present regular files can satisfy a remote citation. */
export function trackedTaskFiles(root) {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--', '.agents/tasks/', '.agents/archive/task-breakdowns/'],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  return output
    .split('\0')
    .filter((file) => file.endsWith('.md'))
    .filter((file) => {
      try {
        return lstatSync(path.join(root, file)).isFile();
      } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
      }
    });
}

export function runAudit({ repo, runner, files = trackedTaskFiles(process.cwd()) }) {
  const issues = readAllIssues(repo, runner === undefined ? {} : { runner });
  return auditIssueTaskPaths(selectActiveIssueScope(issues, repo), files);
}

function main(argv) {
  try {
    const { repo } = parseAuditArgs(argv);
    const { examined, citations, findings } = runAudit({ repo });
    let errors = 0;
    for (const finding of findings) {
      const severity = findingSeverity(finding.outcome);
      if (severity === 'error') errors += 1;
      const destination = finding.actual ? ` → ${finding.actual}` : '';
      process.stderr.write(
        `::${severity} title=Issue #${finding.issueNumber} Task path::line ${finding.line}: ` +
          `${finding.cited} is ${finding.outcome}${destination}; ` +
          `https://github.com/${repo}/issues/${finding.issueNumber}\n`,
      );
    }
    process.stdout.write(
      `Issue Task-path audit: ${examined} active-scope issue(s), ${citations} citation(s), ` +
        `${errors} error(s), ${findings.length - errors} warning(s).\n`,
    );
    return errors === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `::error::Issue Task-path audit unavailable: ${String(error.message).replace(/[\r\n]/g, ' ')}\n`,
    );
    return 1;
  }
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  process.exitCode = main(process.argv.slice(2));
}
