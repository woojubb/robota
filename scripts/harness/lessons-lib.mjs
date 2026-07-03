import { promises as fs } from 'node:fs';
import path from 'node:path';

import { WORKSPACE_ROOT } from './shared.mjs';

const LOCAL_METRICS_DIR = '.agents/evals/local-metrics';
const LESSONS_DIR = '.agents/evals/lessons';
const WEEKLY_DIGEST_FILE = `${LESSONS_DIR}/weekly-digest.md`;
const AUTO_LESSONS_FILE = `${LESSONS_DIR}/auto-lessons.md`;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const PROMOTION_THRESHOLD = 5;

const METRIC_FILES = [
  { source: 'blocks', file: 'blocks.jsonl' },
  { source: 'corrections', file: 'corrections.jsonl' },
  { source: 'reverts', file: 'reverts.jsonl' },
];

export function createStableDigestWindowEnd(date = new Date()) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  );
}

async function readJsonl(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function getPattern(record, source) {
  if (typeof record.pattern === 'string' && record.pattern.trim()) {
    return record.pattern.trim();
  }
  return source;
}

function getExamplePath(record) {
  if (typeof record.file === 'string' && record.file.trim()) {
    return record.file.trim();
  }
  if (typeof record.file_path === 'string' && record.file_path.trim()) {
    return record.file_path.trim();
  }
  return null;
}

/**
 * Path-less events (repeated-tool-errors, fix-or-revert-commit) still carry context in
 * `detail` (LESSON-010) — surface it as the example so the digest never shows an
 * unactionable "(none)" for a signal that has context.
 */
function getExampleDetail(record) {
  if (typeof record.detail === 'string' && record.detail.trim()) {
    return record.detail.trim();
  }
  return null;
}

/**
 * Normalize an example path to a repository-relative form. Returns null for paths outside the
 * workspace (e.g. agent memory under `~/.claude`). Such paths are not repo lessons and must never
 * leak absolute home paths into the generated, committed lessons files — and counting them inflates
 * path-keyed metrics (the same-file-edited signal) with non-repo churn.
 */
function normalizeRepoPath(examplePath, workspaceRoot) {
  if (!examplePath) return null;
  if (!path.isAbsolute(examplePath)) return examplePath; // already repo-relative
  const relative = path.relative(workspaceRoot, examplePath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative;
}

function toTimestamp(record) {
  if (typeof record.timestamp !== 'string') {
    return null;
  }
  const timestamp = Date.parse(record.timestamp);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function ensureGroup(groups, pattern) {
  if (!groups.has(pattern)) {
    groups.set(pattern, {
      pattern,
      frequency: 0,
      sources: new Set(),
      examples: new Set(),
      firstSeen: null,
      lastSeen: null,
    });
  }
  return groups.get(pattern);
}

export async function summarizeLessonSignals({
  workspaceRoot = WORKSPACE_ROOT,
  now = createStableDigestWindowEnd(),
  windowMs = SEVEN_DAYS_MS,
} = {}) {
  const windowEnd = now.getTime();
  const windowStart = windowEnd - windowMs;
  const groups = new Map();

  for (const metricFile of METRIC_FILES) {
    const records = await readJsonl(path.join(workspaceRoot, LOCAL_METRICS_DIR, metricFile.file));
    for (const record of records) {
      const timestamp = toTimestamp(record);
      if (timestamp === null || timestamp < windowStart || timestamp > windowEnd) {
        continue;
      }

      const examplePath = getExamplePath(record);
      const repoPath = normalizeRepoPath(examplePath, workspaceRoot);
      // A path-bearing event outside the repo (e.g. agent memory under ~/.claude) is not a repo
      // lesson — drop it so it neither inflates frequency nor leaks an absolute home path.
      if (examplePath !== null && repoPath === null) {
        continue;
      }

      const group = ensureGroup(groups, getPattern(record, metricFile.source));
      group.frequency += 1;
      group.sources.add(metricFile.source);
      if (repoPath) {
        group.examples.add(repoPath);
      } else {
        const exampleDetail = getExampleDetail(record);
        if (exampleDetail) {
          group.examples.add(exampleDetail);
        }
      }
      const isoTimestamp = new Date(timestamp).toISOString();
      group.firstSeen =
        group.firstSeen === null || isoTimestamp < group.firstSeen ? isoTimestamp : group.firstSeen;
      group.lastSeen =
        group.lastSeen === null || isoTimestamp > group.lastSeen ? isoTimestamp : group.lastSeen;
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      pattern: group.pattern,
      frequency: group.frequency,
      sources: Array.from(group.sources).sort(),
      examples: Array.from(group.examples).sort().slice(0, 5),
      firstSeen: group.firstSeen,
      lastSeen: group.lastSeen,
    }))
    .sort(
      (left, right) =>
        right.frequency - left.frequency || left.pattern.localeCompare(right.pattern),
    );
}

function renderExamples(examples) {
  if (examples.length === 0) {
    return '(none)';
  }
  return examples.map((item) => `\`${item}\``).join(', ');
}

export function renderWeeklyDigest(groups, { now = createStableDigestWindowEnd() } = {}) {
  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString();
  const lines = [
    '# Weekly Auto-Lessons Digest',
    '',
    `Window: ${windowStart} to ${windowEnd}`,
    '',
    'Generated by `pnpm harness:lessons:digest` from local append-only metrics.',
    '',
    '## Signal Summary',
    '',
  ];

  if (groups.length === 0) {
    lines.push('No auto-lesson signals found for this window.', '');
    return `${lines.join('\n')}\n`;
  }

  lines.push('| Pattern | Events | Sources | First Seen | Last Seen | Examples |');
  lines.push('| ------- | ------ | ------- | ---------- | --------- | -------- |');
  for (const group of groups) {
    lines.push(
      `| \`${group.pattern}\` | ${group.frequency} | ${group.sources.join(', ')} | ${group.firstSeen ?? ''} | ${group.lastSeen ?? ''} | ${renderExamples(group.examples)} |`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderAutoLessonEntry(group) {
  return [
    `<!-- auto-lesson:${group.pattern} -->`,
    `## ${group.pattern}`,
    '',
    `- Frequency: ${group.frequency} events in the last 7 days`,
    `- Sources: ${group.sources.join(', ')}`,
    `- Example paths: ${renderExamples(group.examples)}`,
    `- First seen: ${group.firstSeen ?? '(unknown)'}`,
    `- Last seen: ${group.lastSeen ?? '(unknown)'}`,
    '- Status: candidate; human review is required before promotion.',
    '',
  ].join('\n');
}

function upsertSection(content, marker, section) {
  if (!content.includes(marker)) {
    return `${content.trimEnd()}\n\n${section}`;
  }
  const pattern = new RegExp(`${escapeRegExp(marker)}[\\s\\S]*?(?=\\n<!-- auto-lesson:|$)`);
  return content.replace(pattern, section.trimEnd());
}

async function writeAutoLessons(workspaceRoot, groups) {
  const autoLessonsPath = path.join(workspaceRoot, AUTO_LESSONS_FILE);
  await fs.mkdir(path.dirname(autoLessonsPath), { recursive: true });
  let content;
  try {
    content = await fs.readFile(autoLessonsPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
    content = [
      '# Auto Lessons',
      '',
      'Generated candidate lessons from local hook metrics.',
      'Do not promote entries to `.agents/rules/common-mistakes.md` without human review.',
      '',
    ].join('\n');
  }

  let nextContent = content;
  const candidates = groups.filter((item) => item.frequency >= PROMOTION_THRESHOLD);
  for (const group of candidates) {
    const marker = `<!-- auto-lesson:${group.pattern} -->`;
    nextContent = upsertSection(nextContent, marker, renderAutoLessonEntry(group));
  }

  // LESSON-010: drop sections whose pattern fell below threshold in the CURRENT window —
  // upsert-only left May data sitting under a "last 7 days" label indefinitely.
  const currentPatterns = new Set(candidates.map((group) => group.pattern));
  const stalePattern = /<!-- auto-lesson:([^>]*?) -->[\s\S]*?(?=\n<!-- auto-lesson:|$)/g;
  nextContent = nextContent.replace(stalePattern, (section, pattern) =>
    currentPatterns.has(pattern.trim()) ? section : '',
  );
  nextContent = `${nextContent.replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;

  await fs.writeFile(autoLessonsPath, nextContent);
}

const DEDUPE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// Mirrors the detector rules (LESSON-010) so legacy records that the fixed hooks would no
// longer emit are purged instead of polluting the window until they age out.
const WORKFLOW_MULTI_EDIT_PATH_RE = /\.agents\/(backlog|tasks|evals)\//;

function isLegacyFalsePositive(record, source) {
  if (
    source === 'reverts' &&
    getPattern(record, source) === 'same-file-edited-3-times' &&
    WORKFLOW_MULTI_EDIT_PATH_RE.test(String(record.file ?? ''))
  ) {
    return true;
  }
  if (source === 'corrections') {
    const sessionId = String(record.session_id ?? '');
    if (sessionId === '' || sessionId.startsWith('agent')) {
      return true;
    }
  }
  return false;
}

/**
 * Compact the append-only metric logs (LESSON-010): the Stop hook historically re-emitted
 * the same signal on every session Stop, growing reverts.jsonl unboundedly (297k lines).
 * Compaction keeps ONE record per (pattern, file, session_id) — the last, which carries the
 * highest count — plus drops records older than the retention window and unparseable lines.
 * Runs as part of the digest; logs are local-only (gitignored), so this never touches
 * committed history.
 */
export async function compactMetrics({
  workspaceRoot = WORKSPACE_ROOT,
  now = createStableDigestWindowEnd(),
  retentionMs = DEDUPE_RETENTION_MS,
} = {}) {
  const cutoff = now.getTime() - retentionMs;
  const results = [];
  for (const metricFile of METRIC_FILES) {
    const filePath = path.join(workspaceRoot, LOCAL_METRICS_DIR, metricFile.file);
    const records = await readJsonl(filePath);
    if (records.length === 0) {
      results.push({ file: metricFile.file, before: records.length, after: records.length });
      continue;
    }
    const byIdentity = new Map();
    for (const record of records) {
      const timestamp = toTimestamp(record);
      if (timestamp === null || timestamp < cutoff) {
        continue;
      }
      if (isLegacyFalsePositive(record, metricFile.source)) {
        continue;
      }
      const identity = JSON.stringify([
        getPattern(record, metricFile.source),
        record.file ?? record.file_path ?? '',
        record.session_id ?? '',
        // Corrections are per-utterance, not per-session — keep each distinct prompt.
        record.prompt_excerpt ?? '',
        record.detail ?? '',
      ]);
      byIdentity.set(identity, record); // last write wins (highest running count)
    }
    const compacted = Array.from(byIdentity.values());
    if (compacted.length < records.length) {
      await fs.writeFile(
        filePath,
        compacted.length > 0
          ? `${compacted.map((record) => JSON.stringify(record)).join('\n')}\n`
          : '',
      );
    }
    results.push({ file: metricFile.file, before: records.length, after: compacted.length });
  }
  return results;
}

export async function runLessonsDigest({
  workspaceRoot = WORKSPACE_ROOT,
  now = createStableDigestWindowEnd(),
} = {}) {
  await compactMetrics({ workspaceRoot, now });
  const groups = await summarizeLessonSignals({ workspaceRoot, now });
  const digestPath = path.join(workspaceRoot, WEEKLY_DIGEST_FILE);
  await fs.mkdir(path.dirname(digestPath), { recursive: true });
  await fs.writeFile(digestPath, renderWeeklyDigest(groups, { now }));
  await writeAutoLessons(workspaceRoot, groups);
  return {
    groups,
    weeklyDigestPath: digestPath,
    autoLessonsPath: path.join(workspaceRoot, AUTO_LESSONS_FILE),
  };
}
