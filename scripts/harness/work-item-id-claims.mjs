import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const TASKS_DIR = '.agents/tasks';

/** A work-item ID: one or more uppercase segments, then a number. */
export const WORK_ITEM_ID = /\b([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*)-(\d+)\b/g;

/** Every ID that has a live or completed Task record. */
export function idsFromRecords(root = WORKSPACE_ROOT) {
  const dirs = [path.join(root, TASKS_DIR), path.join(root, TASKS_DIR, 'completed')];
  const ids = new Set();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      const match = /^([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d+)/.exec(name);
      if (match) ids.add(match[1]);
    }
  }
  return ids;
}

/** Every ID cited by a tracked file. A failed git read is not an empty claim set. */
export function idsFromCitations(root = WORKSPACE_ROOT) {
  const grep = spawnSync('git', ['grep', '-hoIwE', '[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)*-[0-9]+'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (grep.status !== 0 && grep.status !== 1) {
    throw new Error(
      `allocate-work-item-id: could not read tracked files (git grep exited ${grep.status}). ` +
        'Refusing rather than allocating from a set that was never read.\n' +
        `${grep.stderr ?? ''}`,
    );
  }
  const ids = new Set();
  for (const line of (grep.stdout ?? '').split('\n')) {
    const trimmed = line.trim();
    if (/^[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d+$/.test(trimmed)) ids.add(trimmed);
  }
  return ids;
}

function defaultGh() {
  const listed = spawnSync(
    'gh',
    [
      'issue',
      'list',
      '--state',
      'all',
      '--limit',
      '1000',
      '--json',
      'title,body',
      '-q',
      '.[] | .title, .body',
    ],
    { cwd: WORKSPACE_ROOT, encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024 },
  );
  if (listed.status !== 0) return null;
  return (listed.stdout ?? '').split('\n').filter((line) => line.trim() !== '');
}

/** Every ID named by an issue title or body, or null when GitHub was unreadable. */
export function idsFromIssues({ run = defaultGh } = {}) {
  const result = run();
  if (result === null) return null;
  const ids = new Set();
  for (const text of result) {
    for (const match of text.matchAll(WORK_ITEM_ID)) ids.add(match[0]);
  }
  return ids;
}

let examinedCount = 0;

export function readExamined() {
  return examinedCount;
}

/** Union the readable claim sources and count unique IDs at the point of reading. */
export function collectClaimed(records, citations, issues) {
  examinedCount = 0;
  const claimed = new Set();
  for (const source of [records, citations, issues]) {
    if (source === null) continue;
    for (const id of source) {
      if (claimed.has(id)) continue;
      claimed.add(id);
      examinedCount += 1;
    }
  }
  return claimed;
}

/** Numbers at or above this are fixture space unless a record claims the exact number. */
export const SENTINEL_FLOOR = 900;
export const RECORD_ID_WIDTH = 3;

function formatId(prefix, number) {
  return `${prefix}-${String(number).padStart(RECORD_ID_WIDTH, '0')}`;
}

/** Legacy counter retained for callers that have not moved to Issue-number allocation. */
export function nextFreeId(prefix, claimed, sentinelFloor = SENTINEL_FLOOR, records = new Set()) {
  const pattern = new RegExp(`^${prefix}-(\\d{3,})$`);
  let highest = 0;
  for (const id of claimed) {
    const match = pattern.exec(id);
    if (!match) continue;
    const number = Number(match[1]);
    if (number >= sentinelFloor && !records.has(id)) continue;
    highest = Math.max(highest, number);
  }
  let candidate = highest + 1;
  while (claimed.has(formatId(prefix, candidate))) candidate += 1;
  return formatId(prefix, candidate);
}

/** The integration branch every allocation must be current with. */
export const UPSTREAM_REF = 'origin/develop';

/** Refuse a known stale clone; an offline fetch falls back to the local remote ref. */
export function treeFreshness({ root = WORKSPACE_ROOT, upstream = UPSTREAM_REF } = {}) {
  const git = (args, timeout) =>
    spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 });
  const [remote, ...branchParts] = upstream.split('/');
  const branch = branchParts.join('/');
  const fetch = git(['fetch', '--quiet', remote, branch], 30_000);
  const fetched = fetch.status === 0;
  const resolved = git(['rev-parse', '--verify', '--quiet', `${upstream}^{commit}`]);
  if (resolved.status !== 0) {
    return {
      status: 'unknown',
      behind: null,
      upstreamSha: null,
      fetched,
      reason: `${upstream} is not a ref in this clone${fetched ? '' : ' and could not be fetched'}.`,
    };
  }
  const upstreamSha = resolved.stdout.trim();
  const count = git(['rev-list', '--count', `HEAD..${upstream}`]);
  if (count.status !== 0) {
    return {
      status: 'unknown',
      behind: null,
      upstreamSha,
      fetched,
      reason: `git rev-list --count HEAD..${upstream} exited ${count.status}.`,
    };
  }
  const behind = Number(count.stdout.trim());
  return {
    status: behind > 0 ? 'stale' : 'fresh',
    behind,
    upstreamSha,
    fetched,
    reason: fetched ? null : `${upstream} could not be fetched; measured against the local copy.`,
  };
}
