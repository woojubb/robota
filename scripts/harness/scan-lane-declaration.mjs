#!/usr/bin/env node

/**
 * Lane declaration floor (PROC-016, TC-02).
 *
 * THE GAP THIS CLOSES. `spec-workflow.md` § HARD GATE sent every change down one path whatever its
 * risk: a one-token regex fix paid five gate dispatches, three reviewer rounds and seven commits
 * (session 92807a20, 72 minutes for 4 minutes of implementation). PROC-016 splits the path into
 * lanes — L0, L1, L2 — and the obvious failure mode of a lane system is the one this scan refuses:
 * an agent declares L0 to skip the record. The lane is DECLARED and REFUSED, never argued. A
 * declaration below the floor the diff requires is refused naming the path(s) that set the floor; a
 * declaration above it is accepted, because paying more ceremony than a change needs is a cost the
 * author chose, not a hole.
 *
 * THE FLOORS ARE NOT COPIED HERE. `spec-workflow.md` § "Lane floors" owns the table (`| Floor |
 * Path pattern | Why |`), and this scan PARSES it the way `scan-doc-folder-status-agreement` parses
 * the status table. Two rows carry a qualifier the parser understands:
 *
 *   - `<pattern>#trigger-sections` — the path counts at that floor only when a changed hunk lies
 *     under a `## ` heading named in the second column of the SPEC-update table in
 *     `spec-workflow.md` § Live Spec Policy. That table is parsed too; it is the single owner of
 *     "which SPEC sections are contract".
 *   - a pattern with a `src/` segment (or an explicit `#non-comment` qualifier) counts only a
 *     NON-COMMENT change: a hunk whose added and removed lines are all blank, `//` lines, or
 *     block-comment lines (opener, closer, or a leading ` * `) is not a code change. Decided over
 *     the unified diff.
 *
 * WHERE THE DECLARATION COMES FROM, in priority order: (1) `lane:` frontmatter of any
 * `.agents/spec-docs/**​/*.md` in the changed set; (2) a `Lane: Lx` trailer in the commit messages
 * `base..HEAD`; (3) a `Lane: Lx` line in the PR body. `Fast-track: <reason>` is read from the same
 * three sources. A lower-priority source that disagrees with a higher one is a CONFLICT and is
 * refused — a lane that two records state differently is not a declaration.
 *
 * FAIL-CLOSED, in every direction: an absent rule file throws via `requireGovernedTree`; an absent
 * floors table exits 1 naming the section; a `#trigger-sections` row with no SPEC-update table to
 * read exits 1; a SPEC hunk whose section cannot be located counts as a trigger; a `src/` path the
 * diff carries no hunk for counts as code; a missing declaration exits 1. An EMPTY changed set is
 * the one earned zero — HEAD is the merge base, there is nothing to lane — and it is declared with
 * the `::expected-empty::` marker rather than passed silently.
 *
 * Usage:
 *   node scripts/harness/scan-lane-declaration.mjs [--base <ref>] [--head <rev>] [--root <dir>]
 *        [--changed <path>[,<path>]] [--diff-file <unified-diff>] [--trailers-file <text>]
 *        [--pr-body-file <text>]
 *
 * `--changed` / `--diff-file` / `--trailers-file` replace the git reads (tests need no repository);
 * `HARNESS_PR_BODY_FILE` is the environment form of `--pr-body-file` for callers that cannot pass
 * arguments (the scan runner). The base ref defaults to the merge base with `HARNESS_BASE_REF`,
 * then `origin/$GITHUB_BASE_REF`, then `origin/develop`, then `develop`.
 *
 * Exit code 0 = the declared lane is at or above the floor, 1 = refused.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { frontmatterObject } from './frontmatter.mjs';
import { requireGovernedTree } from './governed-tree.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/** The rule that owns both tables this scan derives its criteria from. */
export const RULE_FILE = '.agents/rules/spec-workflow.md';
/** The heading whose table owns the floors. */
export const FLOORS_HEADING = 'Lane floors';
/** The heading whose SPEC-update table owns the trigger sections. */
export const TRIGGER_HEADING = 'Live Spec Policy';

export const LANES = Object.freeze(['L0', 'L1', 'L2']);
const LANE_RANK = new Map(LANES.map((lane, index) => [lane, index]));

/** Qualifiers a floor row may carry after `#`; anything else is refused, not ignored. */
const KNOWN_QUALIFIERS = new Set(['trigger-sections', 'non-comment']);

const SPEC_DOC_PATTERN = /^\.agents\/spec-docs\/.+\.md$/;
const LANE_LINE = /^\s*Lane:\s*(L[0-2])\s*$/im;
const FAST_TRACK_LINE = /^\s*Fast-track:\s*(.+?)\s*$/im;

function rank(lane) {
  return LANE_RANK.get(lane) ?? -1;
}

function maxLane(a, b) {
  return rank(a) >= rank(b) ? a : b;
}

// ── Rule parsing ─────────────────────────────────────────────────────────────────────────────────

/** The lines of one markdown section: from its heading to the next heading of any level. */
function sectionLines(ruleText, heading) {
  const out = [];
  let inSection = false;
  for (const line of String(ruleText ?? '').split('\n')) {
    if (/^#{1,6}\s/.test(line)) {
      inSection = line.includes(heading);
      continue;
    }
    if (inSection) out.push(line);
  }
  return out;
}

/** The cells of one table row, or null when the line is not a body row (header/separator/prose). */
function tableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const cells = trimmed
    .slice(1, trimmed.endsWith('|') ? -1 : undefined)
    .split('|')
    .map((cell) => cell.trim());
  if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) return null;
  return cells;
}

/** A glob as the floors table writes it (`**`, `*`, `?`, `{a,b}`) → an anchored RegExp. */
export function globToRegExp(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (ch === '?') source += '[^/]';
    else if (ch === '{') {
      const close = glob.indexOf('}', i);
      if (close === -1) source += '\\{';
      else {
        source += `(?:${glob
          .slice(i + 1, close)
          .split(',')
          .map((alt) => alt.replace(/[.+^$()|[\]\\]/g, '\\$&'))
          .join('|')})`;
        i = close;
      }
    } else source += ch.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/**
 * Parse the floors table under `#### Lane floors`.
 *
 * Returns `[{ floor, pattern, qualifier, why }]`, one entry per pattern (a row may list several in
 * backticks). Empty when the heading or its rows are absent — the caller treats that as a failure,
 * never as "no floors". A row whose floor cell is not L0/L1/L2, or whose qualifier is unknown,
 * throws: a floor this scan cannot read is a floor it cannot enforce.
 */
export function parseLaneFloors(ruleText) {
  const rows = [];
  let sawHeader = false;
  for (const line of sectionLines(ruleText, FLOORS_HEADING)) {
    const cells = tableCells(line);
    if (!cells || cells.length < 2) continue;
    if (!sawHeader) {
      sawHeader = true;
      if (/^floor$/i.test(cells[0])) continue;
    }
    const floorMatch = /\bL([0-2])\b/.exec(cells[0]);
    if (!floorMatch) {
      throw new Error(
        `lane-declaration: floors row "${cells[0]}" names no lane (L0/L1/L2) — ` +
          `${RULE_FILE} § ${FLOORS_HEADING} carries a row this scan cannot enforce.`,
      );
    }
    const floor = `L${floorMatch[1]}`;
    const why = cells[2] ?? '';
    const backticked = [...cells[1].matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
    const patterns = backticked.length > 0 ? backticked : [cells[1].trim()];
    for (const raw of patterns) {
      if (raw === '') continue;
      const hash = raw.indexOf('#');
      const pattern = hash === -1 ? raw : raw.slice(0, hash);
      const qualifier = hash === -1 ? null : raw.slice(hash + 1).trim();
      if (qualifier !== null && !KNOWN_QUALIFIERS.has(qualifier)) {
        throw new Error(
          `lane-declaration: floors row \`${raw}\` carries the qualifier #${qualifier}, which this ` +
            `scan does not implement (known: ${[...KNOWN_QUALIFIERS].map((q) => `#${q}`).join(', ')}).`,
        );
      }
      // A prose cell such as "everything else" is the default floor, not a glob; it matches every path.
      const looksLikeGlob = backticked.length > 0 || /[/*.?{]/.test(pattern);
      rows.push({
        floor,
        pattern: looksLikeGlob ? pattern : '**',
        qualifier:
          qualifier ?? (looksLikeGlob && /(^|\/)src\//.test(pattern) ? 'non-comment' : null),
        why,
      });
    }
  }
  return rows;
}

/**
 * The SPEC section names the SPEC-update table (§ Live Spec Policy, second column) points at.
 *
 * `State Lifecycle / Event Architecture` and `Architecture Overview, relevant section` are cells
 * naming more than one heading, so a cell is split on `/` and `,`. Returns [] when the table is
 * absent; the caller fails closed on that whenever a `#trigger-sections` row needs it.
 */
export function parseSpecTriggerSections(ruleText) {
  const names = [];
  let sawHeader = false;
  for (const line of sectionLines(ruleText, TRIGGER_HEADING)) {
    const cells = tableCells(line);
    if (!cells || cells.length < 2) continue;
    if (!sawHeader) {
      sawHeader = true;
      if (/^what changed$/i.test(cells[0])) continue;
    }
    for (const piece of cells[1].split(/[/,]/)) {
      const name = piece.replace(/\*\*/g, '').trim();
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

// ── Diff parsing ─────────────────────────────────────────────────────────────────────────────────

/**
 * A unified diff → `Map<path, { hunks: [{ newStart, lines: [{ kind, text, newLine }] }] }>`.
 *
 * The path is the post-image (`+++ b/…`), or the pre-image for a deletion. `newLine` is the line
 * number in the post-image: for `+` and context lines their own; for a `-` line the position the
 * removal leaves behind, so a removal can be placed under the heading that now covers that spot.
 */
export function parseUnifiedDiff(diffText) {
  const files = new Map();
  let current = null;
  let hunk = null;
  let newLine = 0;
  let oldPath = null;
  for (const line of String(diffText ?? '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = null;
      hunk = null;
      oldPath = null;
      continue;
    }
    if (line.startsWith('--- ')) {
      const p = line.slice(4).trim();
      oldPath = p === '/dev/null' ? null : p.replace(/^a\//, '');
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      const filePath = p === '/dev/null' ? oldPath : p.replace(/^b\//, '');
      if (!filePath) continue;
      current = files.get(filePath) ?? { hunks: [] };
      files.set(filePath, current);
      hunk = null;
      continue;
    }
    if (line.startsWith('Binary files ') && oldPath) {
      const filePath = oldPath;
      current = files.get(filePath) ?? { hunks: [] };
      current.binary = true;
      files.set(filePath, current);
      continue;
    }
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header && current) {
      newLine = Number(header[1]);
      hunk = { newStart: newLine, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith('\\ No newline')) continue;
    const kind = line[0] === '+' ? '+' : line[0] === '-' ? '-' : ' ';
    const text = line.slice(1);
    hunk.lines.push({ kind, text, newLine });
    if (kind !== '-') newLine += 1;
  }
  return files;
}

/** Whether one added/removed line is blank or a JS-style comment line. */
export function isCommentOrBlankLine(text) {
  const t = text.trim();
  return (
    t === '' ||
    t.startsWith('//') ||
    t.startsWith('/*') ||
    t.startsWith('*/') ||
    t.startsWith('* ') ||
    t === '*' ||
    /^\/\*.*\*\/$/.test(t)
  );
}

/** Whether a hunk changes anything beyond blank and comment lines. */
export function hunkHasCodeChange(hunk) {
  return hunk.lines.some((l) => l.kind !== ' ' && !isCommentOrBlankLine(l.text));
}

/** `## Heading` → its comparable name: numbering, trailing punctuation and case removed. */
function headingName(text) {
  return text
    .replace(/^#{2}\s+/, '')
    .replace(/^\d+(?:\.\d+)*\.?\s*/, '')
    .replace(/\s*[:.]\s*$/, '')
    .trim()
    .toLowerCase();
}

function isLevelTwoHeading(text) {
  return /^##\s+\S/.test(text);
}

function namesTriggerSection(headingText, triggerSections) {
  const name = headingName(headingText);
  return triggerSections.some((section) => {
    const wanted = section.toLowerCase();
    return (
      name === wanted ||
      (name.startsWith(wanted) && /^[^a-z0-9]/.test(name.slice(wanted.length) || ' '))
    );
  });
}

/**
 * Whether any changed line of this file lies under a trigger `## ` heading.
 *
 * The heading in effect for a line is the last `## ` at or above its post-image position, read from
 * the post-image text when the caller can supply it, else from the headings the diff itself shows
 * before that line. A changed line that IS a level-two heading is judged by its own name (a removed
 * `## Public API Surface` is a contract change even though the post-image no longer carries it).
 * No heading locatable at all → the section is unknown → counts as a trigger (fail-closed).
 */
export function fileTouchesTriggerSection(file, triggerSections, fileText) {
  if (file.binary) return { touches: true, section: '(binary — section unknown)' };
  const fileLines = typeof fileText === 'string' ? fileText.split('\n') : null;
  const seenInDiff = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (isLevelTwoHeading(line.text) && line.kind !== '-') seenInDiff.push(line.text);
      if (line.kind === ' ') continue;
      if (isLevelTwoHeading(line.text)) {
        if (namesTriggerSection(line.text, triggerSections)) {
          return { touches: true, section: line.text.trim() };
        }
        continue;
      }
      let heading = null;
      if (fileLines) {
        for (let i = Math.min(line.newLine, fileLines.length) - 1; i >= 0; i--) {
          if (isLevelTwoHeading(fileLines[i])) {
            heading = fileLines[i];
            break;
          }
        }
      }
      if (heading === null && seenInDiff.length > 0) heading = seenInDiff[seenInDiff.length - 1];
      if (heading === null) {
        return { touches: true, section: '(section could not be located — counted as a trigger)' };
      }
      if (namesTriggerSection(heading, triggerSections)) {
        return { touches: true, section: heading.trim() };
      }
    }
  }
  return { touches: false, section: null };
}

// ── Declaration ──────────────────────────────────────────────────────────────────────────────────

/**
 * Collect the lane and fast-track declarations from the three sources.
 *
 * @param {{ specDocs?: {path: string, text: string}[], trailersText?: string, prBodyText?: string }} sources
 * @returns {{ lane: string|null, fastTrack: string|null, source: string|null, conflicts: string[] }}
 */
export function collectDeclaration({ specDocs = [], trailersText = '', prBodyText = '' } = {}) {
  const found = [];
  const fastTracks = [];
  for (const { path: docPath, text } of specDocs) {
    const fm = frontmatterObject(text);
    const lane = typeof fm.lane === 'string' ? fm.lane.trim().toUpperCase() : null;
    if (lane) found.push({ source: `spec-doc frontmatter ${docPath}`, lane, priority: 1 });
    const fast = typeof fm['fast-track'] === 'string' ? fm['fast-track'].trim() : '';
    if (fast) fastTracks.push({ source: `spec-doc frontmatter ${docPath}`, reason: fast });
  }
  const trailerLane = LANE_LINE.exec(trailersText ?? '');
  if (trailerLane) {
    found.push({ source: 'commit trailer', lane: trailerLane[1].toUpperCase(), priority: 2 });
  }
  const trailerFast = FAST_TRACK_LINE.exec(trailersText ?? '');
  if (trailerFast) fastTracks.push({ source: 'commit trailer', reason: trailerFast[1] });
  const bodyLane = LANE_LINE.exec(prBodyText ?? '');
  if (bodyLane) found.push({ source: 'PR body', lane: bodyLane[1].toUpperCase(), priority: 3 });
  const bodyFast = FAST_TRACK_LINE.exec(prBodyText ?? '');
  if (bodyFast) fastTracks.push({ source: 'PR body', reason: bodyFast[1] });

  const conflicts = [];
  for (const entry of found) {
    if (!LANE_RANK.has(entry.lane)) {
      conflicts.push(
        `${entry.source} declares \`${entry.lane}\`, which is not one of ${LANES.join('/')}`,
      );
    }
  }
  found.sort((a, b) => a.priority - b.priority);
  const primary = found.find((entry) => LANE_RANK.has(entry.lane)) ?? null;
  if (primary) {
    for (const entry of found) {
      if (entry !== primary && LANE_RANK.has(entry.lane) && entry.lane !== primary.lane) {
        conflicts.push(
          `${primary.source} declares ${primary.lane} but ${entry.source} declares ${entry.lane}`,
        );
      }
    }
  }
  return {
    lane: primary?.lane ?? null,
    source: primary?.source ?? null,
    fastTrack: fastTracks.length > 0 ? fastTracks[0].reason : null,
    fastTrackSource: fastTracks.length > 0 ? fastTracks[0].source : null,
    conflicts,
  };
}

// ── Decision ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The floor one path requires, with the row that set it.
 *
 * @returns {{ floor: string, why: string|null }}
 */
export function floorForPath(filePath, { diffFiles, floors, specTriggerSections, readFile }) {
  let floor = 'L0';
  let why = null;
  const file = diffFiles.get(filePath) ?? null;
  for (const row of floors) {
    if (rank(row.floor) <= rank(floor)) continue;
    if (!globToRegExp(row.pattern).test(filePath)) continue;
    let applies = true;
    let detail = '';
    if (row.qualifier === 'non-comment') {
      // No hunk for a path the diff should carry → cannot prove comment-only → counts as code.
      applies =
        !file || file.binary || file.hunks.length === 0 || file.hunks.some(hunkHasCodeChange);
      if (!applies) continue;
      detail = file ? ' (non-comment change)' : ' (no hunk in the diff — counted as code)';
    } else if (row.qualifier === 'trigger-sections') {
      if (specTriggerSections.length === 0) {
        throw new Error(
          `lane-declaration: \`${row.pattern}#trigger-sections\` needs the SPEC-update table under ` +
            `${RULE_FILE} § ${TRIGGER_HEADING}, and it could not be read.`,
        );
      }
      if (!file) {
        detail = ' (no hunk in the diff — section unknown, counted as a trigger)';
      } else {
        const text = typeof readFile === 'function' ? readFile(filePath) : null;
        const verdict = fileTouchesTriggerSection(file, specTriggerSections, text);
        if (!verdict.touches) continue;
        detail = ` (hunk under ${verdict.section})`;
      }
    }
    floor = row.floor;
    why = `\`${row.pattern}\`${detail}`;
  }
  return { floor, why };
}

/** RESET per walk, so a run that walks nothing cannot report the previous run's number. */
let examinedPaths = 0;

/** How many changed paths the last walk judged — the size `::examined::` publishes. */
export function readExamined() {
  return examinedPaths;
}

/**
 * The walk: the floor each changed path requires, and the diff's floor (the highest of them).
 * No git, no filesystem — `readFile` is the caller's seam for post-image text.
 *
 * @returns {{ floor: string, perPath: {path, floor, why}[], setters: {path, floor, why}[] }}
 */
export function findLaneFloors({
  changedPaths,
  diffText = '',
  floors,
  specTriggerSections = [],
  readFile,
}) {
  if (!Array.isArray(floors) || floors.length === 0) {
    throw new Error(
      `lane-declaration: no floors to judge against — ${RULE_FILE} § ${FLOORS_HEADING} is absent ` +
        'or carries no rows. The floor derives its criteria from that table and refuses to pass without them.',
    );
  }
  examinedPaths = 0;
  const diffFiles = parseUnifiedDiff(diffText);
  const paths = [
    ...new Set((changedPaths ?? []).map((p) => String(p).trim()).filter(Boolean)),
  ].sort();
  const perPath = [];
  for (const filePath of paths) {
    examinedPaths += 1;
    perPath.push({
      path: filePath,
      ...floorForPath(filePath, { diffFiles, floors, specTriggerSections, readFile }),
    });
  }
  const floor = perPath.reduce((acc, entry) => maxLane(acc, entry.floor), 'L0');
  const setters = perPath.filter((entry) => entry.floor === floor && entry.why);
  return { floor, perPath, setters };
}

/**
 * The pure decision: the walk above, compared with the declaration.
 *
 * @param {{
 *   changedPaths: string[],
 *   diffText?: string,
 *   declaration: ReturnType<typeof collectDeclaration>,
 *   floors: ReturnType<typeof parseLaneFloors>,
 *   specTriggerSections: string[],
 *   readFile?: (path: string) => string|null,
 * }} input
 * @returns {{ ok: boolean, floor: string, lane: string|null, perPath: {path, floor, why}[], refusals: string[] }}
 */
export function decideLane({ declaration, ...walkInput }) {
  const { floor, perPath, setters } = findLaneFloors(walkInput);

  const refusals = [];
  const lane = declaration?.lane ?? null;
  for (const conflict of declaration?.conflicts ?? [])
    refusals.push(`conflicting declarations: ${conflict}`);
  if (!lane) {
    refusals.push(
      'no lane declared — add `lane: L0|L1|L2` to the spec document frontmatter, a `Lane: Lx` ' +
        'commit trailer, or a `Lane: Lx` line in the PR body',
    );
  } else if (rank(lane) < rank(floor)) {
    refusals.push(
      `declared ${lane} is below the floor ${floor} set by: ` +
        setters.map((entry) => `${entry.path} ${entry.why}`).join('; '),
    );
  }
  if (declaration?.fastTrack && rank(floor) >= rank('L2')) {
    refusals.push(
      `Fast-track: "${declaration.fastTrack}" (${declaration.fastTrackSource}) is not available on an ` +
        `L2 path — ${setters.map((entry) => entry.path).join(', ')}`,
    );
  }
  return { ok: refusals.length === 0, floor, lane, perPath, refusals };
}

// ── main(): git and filesystem live here ─────────────────────────────────────────────────────────

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function runGit(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function resolveMergeBase(root, requested, env) {
  const githubBase = env.GITHUB_BASE_REF
    ? env.GITHUB_BASE_REF.startsWith('origin/')
      ? env.GITHUB_BASE_REF
      : `origin/${env.GITHUB_BASE_REF}`
    : null;
  const candidates = requested
    ? [requested]
    : [env.HARNESS_BASE_REF, githubBase, 'origin/develop', 'develop'].filter(Boolean);
  for (const candidate of candidates) {
    const verified = runGit(root, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]);
    if (verified.code !== 0) continue;
    const mergeBase = runGit(root, ['merge-base', 'HEAD', candidate]);
    if (mergeBase.code === 0 && mergeBase.stdout.trim()) return mergeBase.stdout.trim();
  }
  throw new Error(
    `lane-declaration: no merge base could be resolved from ${candidates.join(', ') || '(none)'}.`,
  );
}

function readOptional(filePath) {
  return filePath && existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
}

/** Gather the inputs `decideLane` needs, from flags where given and from git otherwise. */
export function gatherInputs(argv, { root = WORKSPACE_ROOT, env = process.env } = {}) {
  const changedArg = argValue(argv, '--changed');
  const diffFile = argValue(argv, '--diff-file');
  const trailersFile = argValue(argv, '--trailers-file');
  const prBodyFile = argValue(argv, '--pr-body-file') ?? env.HARNESS_PR_BODY_FILE;
  const head = argValue(argv, '--head') ?? 'HEAD';
  const offline = changedArg !== undefined || diffFile !== undefined;

  let changedPaths = [];
  let diffText = '';
  let trailersText = '';
  let base = null;
  if (offline) {
    diffText = diffFile ? readFileSync(diffFile, 'utf8') : '';
    changedPaths = changedArg
      ? changedArg
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
      : [...parseUnifiedDiff(diffText).keys()];
  } else {
    base = resolveMergeBase(root, argValue(argv, '--base'), env);
    const names = runGit(root, ['diff', '--name-only', '--diff-filter=ACMRD', base, head]);
    if (names.code !== 0)
      throw new Error(`lane-declaration: git diff --name-only failed: ${names.stderr}`);
    changedPaths = names.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const diff = runGit(root, ['diff', '--no-color', '--no-ext-diff', base, head]);
    if (diff.code !== 0) throw new Error(`lane-declaration: git diff failed: ${diff.stderr}`);
    diffText = diff.stdout;
  }
  if (trailersFile) trailersText = readFileSync(trailersFile, 'utf8');
  else if (!offline) {
    const log = runGit(root, ['log', '--format=%B', `${base}..${head}`]);
    if (log.code !== 0) throw new Error(`lane-declaration: git log failed: ${log.stderr}`);
    trailersText = log.stdout;
  }
  const specDocs = changedPaths
    .filter((p) => SPEC_DOC_PATTERN.test(p))
    .map((p) => ({ path: p, text: readOptional(path.join(root, p)) }))
    .filter((entry) => entry.text !== null);
  const prBodyText = readOptional(prBodyFile) ?? '';
  return {
    base,
    changedPaths,
    diffText,
    declaration: collectDeclaration({ specDocs, trailersText, prBodyText }),
    readFile: (p) => readOptional(path.join(root, p)),
  };
}

function main(argv = process.argv.slice(2)) {
  const root = argValue(argv, '--root') ? path.resolve(argValue(argv, '--root')) : WORKSPACE_ROOT;
  requireGovernedTree(root, [RULE_FILE], {
    scan: 'lane-declaration',
    why: 'The floors and the SPEC trigger sections are read from that rule; without it no lane can be judged.',
  });
  const ruleText = readFileSync(path.join(root, RULE_FILE), 'utf8');
  const floors = parseLaneFloors(ruleText);
  if (floors.length === 0) {
    console.error(
      `❌ Could not read the lane floors table from ${RULE_FILE} § "#### ${FLOORS_HEADING}". The ` +
        'floor derives its criteria from that table and refuses to pass without them.',
    );
    console.error('lane-declaration summary: violations=1 result=FAIL');
    process.exit(1);
  }
  const specTriggerSections = parseSpecTriggerSections(ruleText);

  const inputs = gatherInputs(argv, { root });
  const verdict = decideLane({ ...inputs, floors, specTriggerSections });
  if (readExamined() === 0) {
    console.log(
      `::examined:: 0 changed path(s) ::expected-empty:: HEAD is the merge base` +
        `${inputs.base ? ` (${inputs.base.slice(0, 12)})` : ''} — there is no diff to lane`,
    );
    console.log('lane-declaration summary: violations=0 result=PASS');
    return;
  }
  console.log(`::examined:: ${readExamined()} changed path(s)`);

  for (const entry of verdict.perPath) {
    console.log(`  ${entry.floor}  ${entry.path}${entry.why ? `  ← ${entry.why}` : ''}`);
  }
  const declared = verdict.lane ? `${verdict.lane} (${inputs.declaration.source})` : '(none)';
  if (verdict.ok) {
    console.log(`✅ Lane ${declared} is at or above the floor ${verdict.floor}.`);
    console.log('lane-declaration summary: violations=0 result=PASS');
    return;
  }
  console.error(`❌ Lane declaration refused (declared ${declared}, floor ${verdict.floor}):`);
  for (const refusal of verdict.refusals) console.error(`  - ${refusal}`);
  console.error(
    `\n${RULE_FILE} § ${FLOORS_HEADING}: a lane is declared and refused, never argued. Raise the ` +
      'declaration to the floor, or drop the change that sets it.',
  );
  console.error(`lane-declaration summary: violations=${verdict.refusals.length} result=FAIL`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    main();
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    console.error('lane-declaration summary: violations=1 result=FAIL');
    process.exit(1);
  }
}
