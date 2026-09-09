#!/usr/bin/env node

import path from 'node:path';

import { fetchAllPages } from './github-api.mjs';

const DEFAULT_PER_PAGE = 100;
const HOUR_MS = 60 * 60 * 1000;
const ISO_8601 = /T/;
const REPO = /^[^/\s]+\/[^/\s]+$/;
const USAGE =
  'usage: issue-throughput.mjs --repo <owner/name> (--window <hours>h [--end <ISO-8601>] | --start <ISO-8601> --end <ISO-8601>)';

function parseTimestamp(value, flag) {
  if (typeof value !== 'string' || !ISO_8601.test(value)) {
    throw new Error(`${flag} must be an ISO-8601 timestamp containing a date and time`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${flag} must be a valid ISO-8601 timestamp`);
  return { milliseconds: timestamp, iso: new Date(timestamp).toISOString() };
}

function parseWindowHours(value) {
  const match = /^(\d+(?:\.\d+)?)h$/.exec(value ?? '');
  const hours = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`--window must be a positive number of hours such as 168h`);
  }
  return hours;
}

/** Parse one of the two mutually exclusive exact-window forms used by the operator command. */
export function parseArgs(argv, { now = new Date() } = {}) {
  let repo;
  let windowValue;
  let startValue;
  let endValue;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!['--repo', '--window', '--start', '--end'].includes(flag)) {
      throw new Error(`unknown argument ${flag ?? '(missing)'}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (flag === '--repo') repo = value;
    if (flag === '--window') windowValue = value;
    if (flag === '--start') startValue = value;
    if (flag === '--end') endValue = value;
    index += 1;
  }

  if (!repo || !REPO.test(repo)) throw new Error('--repo must be in owner/name form');
  if (windowValue !== undefined && startValue !== undefined) {
    throw new Error('use either --window or --start/--end, not both');
  }
  if (windowValue === undefined && (startValue === undefined || endValue === undefined)) {
    throw new Error('provide --window or both --start and --end');
  }
  if (windowValue !== undefined && endValue === undefined) endValue = new Date(now).toISOString();

  const windowHours = windowValue === undefined ? undefined : parseWindowHours(windowValue);
  const end = parseTimestamp(endValue, '--end');
  const start =
    windowHours === undefined
      ? parseTimestamp(startValue, '--start')
      : {
          milliseconds: end.milliseconds - windowHours * HOUR_MS,
          iso: new Date(end.milliseconds - windowHours * HOUR_MS).toISOString(),
        };
  if (start.milliseconds >= end.milliseconds) throw new Error('--start must be earlier than --end');

  return {
    repo,
    start: start.iso,
    end: end.iso,
    windowHours,
  };
}

function issueRecord(record) {
  return Boolean(record && typeof record === 'object' && !('pull_request' in record));
}

function eventInWindow(value, boundary, field) {
  if (value === null || value === undefined) return false;
  const timestamp = parseTimestamp(value, field).milliseconds;
  return timestamp >= boundary.start && timestamp < boundary.end;
}

function collection(endpoint, readPages) {
  const result = readPages(endpoint);
  if (!result || !Array.isArray(result.records)) {
    throw new Error(`${endpoint}: reader returned no records array`);
  }
  if (!Number.isInteger(result.pages) || result.pages < 1) {
    throw new Error(`${endpoint}: reader returned no positive page count`);
  }
  return result;
}

function defaultReadPages(endpoint) {
  return fetchAllPages(endpoint, { perPage: DEFAULT_PER_PAGE });
}

/** Read and count the two canonical REST collections without performing any GitHub mutation. */
export function measureThroughput({ repo, start, end, readPages = defaultReadPages }) {
  const normalizedStart = parseTimestamp(start, 'start');
  const normalizedEnd = parseTimestamp(end, 'end');
  if (normalizedStart.milliseconds >= normalizedEnd.milliseconds) {
    throw new Error('start must be earlier than end');
  }
  const boundary = { start: normalizedStart.milliseconds, end: normalizedEnd.milliseconds };
  const activityEndpoint =
    `repos/${repo}/issues?state=all&since=${encodeURIComponent(normalizedStart.iso)}` +
    `&per_page=${DEFAULT_PER_PAGE}`;
  const openEndpoint = `repos/${repo}/issues?state=open&per_page=${DEFAULT_PER_PAGE}`;
  const activity = collection(activityEndpoint, readPages);
  const open = collection(openEndpoint, readPages);
  const activityIssues = activity.records.filter(issueRecord);
  const openIssues = open.records.filter(issueRecord);

  const created = activityIssues.filter((record) =>
    eventInWindow(record.created_at, boundary, 'created_at'),
  ).length;
  const closed = activityIssues.filter((record) =>
    eventInWindow(record.closed_at, boundary, 'closed_at'),
  ).length;

  return {
    repository: repo,
    window: {
      start: normalizedStart.iso,
      end: normalizedEnd.iso,
      boundary: '[start,end)',
      timezone: 'UTC',
    },
    query: {
      activity: 'GET /repos/{owner}/{repo}/issues?state=all&since=<start>&per_page=100',
      openEndpoint: 'GET /repos/{owner}/{repo}/issues?state=open&per_page=100',
      issueQualification: 'issues only; records carrying pull_request are excluded',
      created: 'created_at in [start,end)',
      closed: 'closed_at in [start,end)',
      open: 'state=open snapshot at measurement time',
    },
    pagination: {
      strategy: 'GitHub REST --paginate --slurp',
      pagesRead: { activity: activity.pages, open: open.pages },
      complete: true,
    },
    counts: { open: openIssues.length, created, closed, net: created - closed },
  };
}

export function main(argv, io = { stdout: process.stdout, stderr: process.stderr }, deps = {}) {
  try {
    const options = parseArgs(argv, { now: deps.now ?? new Date() });
    const result = measureThroughput({ ...options, readPages: deps.readPages ?? defaultReadPages });
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    io.stderr.write(
      `::error::${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`,
    );
    return 1;
  }
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  process.exitCode = main(process.argv.slice(2));
}
