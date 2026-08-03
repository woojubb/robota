#!/usr/bin/env node

/**
 * SEC-007 — mechanical floor: harness code that queries a paginated API must PAGINATE.
 *
 * ## Why this is a scan and not a note
 *
 * Twice now an unpaginated `gh api` has produced a false all-clear in this repo. The second time
 * (SEC-006) the reported result was `0 high` code-scanning alerts on every ref while 40 were open:
 * the alerts endpoint sorts by `created` descending and pages at 100, and a burst of 98 freshly-filed
 * `note` alerts filled page one, pushing every security-severity alert onto page two.
 *
 * What makes the trap survive a careful reader is that its output is INDISTINGUISHABLE from success.
 * There is no error, no gap, no missing field — just a smaller number. Prose telling the next author
 * to remember `--paginate` has already failed twice, so the rule is mechanical.
 *
 * ## What is flagged
 *
 * A `gh api` invocation in `scripts/**` or `.github/workflows/**` that reads a LIST endpoint without
 * `--paginate`. "List endpoint" is decided by two independent signals, either of which is sufficient:
 *
 *  1. **The call declares `per_page=`.** Writing a page size is proof the author knew the endpoint
 *     paginates. A page size without `--paginate` is the trap in its purest form.
 *  2. **The path matches a known-paginated GitHub collection** (`/code-scanning/alerts`,
 *     `/check-runs`, `/labels`, `/rules/branches/`, …). This catches the more dangerous shape: a call
 *     with NO `per_page` at all, which silently takes the API default of 30.
 *
 * A single-record existence probe is legitimate (`per_page=1` asked only "does any record exist?"),
 * so there is an escape hatch — but it must state its reason, and reason-less annotations are
 * themselves a finding, mirroring the `allow-fallback` / `allow-fake` convention:
 *
 *   # allow-unpaginated: existence probe only — the COUNT is never read
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { requireGovernedTree } from './governed-tree.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/** Directories whose GitHub-API reads this floor governs. */
const SCAN_ROOTS = ['scripts', '.github/workflows'];

/** Only files that can actually invoke `gh`. */
const SCANNED_EXTENSIONS = new Set(['.mjs', '.js', '.cjs', '.ts', '.sh', '.yml', '.yaml']);

/**
 * GitHub collections that are paginated and are read by harness code. Deliberately a SHORT list of
 * endpoints this repo actually touches rather than an attempt to enumerate the API: an over-broad
 * list produces noise, and signal (1) above already covers anything that declares a page size.
 */
const PAGINATED_PATHS = [
  '/code-scanning/alerts',
  '/code-scanning/analyses',
  '/check-runs',
  '/check-suites',
  '/rules/branches/',
  '/labels',
  '/issues',
  '/pulls',
  '/commits',
  '/runs',
  '/artifacts',
  '/releases',
  '/workflows',
  '/branches',
  '/tags',
];

/** A well-formed escape hatch: the token followed by `:` and at least one non-space reason char. */
const ANNOTATION_WITH_REASON = /allow-unpaginated:\s*\S/;
const ANNOTATION = /allow-unpaginated/;

/** The shell form: `gh api <endpoint>` in a workflow step or a shell script. */
const GH_API_SHELL = /(?:^|[^\w-])gh\s+api\b/;

/**
 * The argv form: `spawnSync('gh', ['api', …])`. Node harness scripts invoke `gh` through an argv
 * vector, which the shell regex cannot see — and that is where the `rules/branches` read lived.
 */
const GH_API_ARGV = /['"]gh['"][\s\S]{0,40}?\[\s*['"]api['"]/;

/** Whether the line is a comment in any of the scanned languages. */
function isCommentLine(line) {
  return /^\s*(?:#|\/\/|\*|<!--)/.test(line);
}

/**
 * A Node script never invokes `gh` as a bare shell word — it uses an argv vector, which the argv
 * pattern above matches. So in a script file the literal text `gh api` is PROSE: an error message
 * quoting the command it just ran (`` `\`gh api …\` failed: ${stderr}` ``), or a doc comment.
 * Flagging those would point the reader at the wrong line and teach them to ignore the scan.
 */
function usesShellForm(file) {
  return !/\.(?:mjs|js|cjs|ts)$/.test(file);
}

/**
 * Pure content check (exposed for tests). One finding per `gh api` line that reads a paginated
 * collection without `--paginate`, unless suppressed by an `allow-unpaginated: <reason>` on the line
 * or the line above.
 */
export function findUnpaginatedQueries(source, file = 'fixture.sh') {
  const findings = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // Anti-rot: a reason-less annotation is its own finding, so the hatch cannot decay into a token.
    if (ANNOTATION.test(line) && !ANNOTATION_WITH_REASON.test(line)) {
      findings.push({
        file,
        line: i + 1,
        kind: 'reasonless-annotation',
        text: line.trim().slice(0, 140),
      });
    }

    if (isCommentLine(line)) continue;

    const isShellCall = usesShellForm(file) && GH_API_SHELL.test(line);
    // The argv form spans several lines, so it is matched over a small forward window.
    const argvWindow = lines.slice(i, i + 4).join('\n');
    const isArgvCall = GH_API_ARGV.test(argvWindow) && /['"]gh['"]/.test(line);
    if (!isShellCall && !isArgvCall) continue;

    // A call may be split across continuation lines (shell `\`, or a multi-line argv array); read the
    // whole invocation so `--paginate` on line 2 is not reported as missing on line 1.
    let invocation = line;
    let end = i;
    if (isArgvCall) {
      invocation = argvWindow;
    } else {
      while (/\\\s*$/.test(lines[end]) && end + 1 < lines.length) {
        end += 1;
        invocation += `\n${lines[end]}`;
      }
    }

    if (/--paginate\b/.test(invocation)) continue;

    const declaresPageSize = /[?&]per_page=/.test(invocation);
    const touchesCollection = PAGINATED_PATHS.some((endpoint) => invocation.includes(endpoint));
    if (!declaresPageSize && !touchesCollection) continue;

    // Suppression comes from the invocation itself or from the CONTIGUOUS comment block directly
    // above it. A block is used rather than one line because a reason worth writing rarely fits on
    // one, and it cannot bleed onto an unrelated call: the block ends at the first non-comment line,
    // which is this call.
    let suppressed = ANNOTATION_WITH_REASON.test(invocation);
    for (let above = i - 1; !suppressed && above >= 0 && isCommentLine(lines[above]); above -= 1) {
      suppressed = ANNOTATION_WITH_REASON.test(lines[above]);
    }
    if (suppressed) continue;

    findings.push({
      file,
      line: i + 1,
      kind: declaresPageSize ? 'per-page-without-paginate' : 'unpaginated-collection',
      text: line.trim().slice(0, 140),
    });
  }

  findings.push(...findParallelFanOut(source, file));
  return findings;
}

/**
 * A parallel fan-out of API calls is a rate limit waiting to happen.
 *
 * The API answers a burst with a SECONDARY limit — a 403 carrying a rate-limit message rather than
 * the 429 a caller would look for — and that limit outlives the burst, so the next unrelated read
 * fails too. Unlike the primary budget, it is not reported by the rate-limit endpoint, which keeps
 * showing a healthy remaining count while every call is refused.
 *
 * Serial pagination is not the problem and is not flagged: a paginating read walks one page at a
 * time. What earns a finding is a loop that dispatches many independent calls at once — the shape
 * that turns one expensive question into thousands of requests. Ask a coarser endpoint first, or
 * accept it serially, or route the read through the shared helper, which waits out a limit instead
 * of amplifying it.
 */
const PARALLEL_FAN_OUT = /xargs[^\n]*-P\s*[2-9]|xargs[^\n]*-P\s*\d\d|parallel\s+-j\s*[2-9]|&\s*$/;

export function findParallelFanOut(source, file = 'fixture.sh') {
  const findings = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    if (!PARALLEL_FAN_OUT.test(line)) continue;
    // Only when the thing being fanned out is an API call — a parallel build is not this rule's
    // business. The call may be in the same line or in the function the loop invokes, so the file is
    // searched rather than the line.
    if (!/gh\s+api|api\.github\.com/.test(source)) continue;
    let suppressed = ANNOTATION_WITH_REASON.test(line);
    for (let above = i - 1; !suppressed && above >= 0 && isCommentLine(lines[above]); above -= 1) {
      suppressed = ANNOTATION_WITH_REASON.test(lines[above]);
    }
    if (suppressed) continue;
    findings.push({
      file,
      line: i + 1,
      kind: 'parallel-api-fan-out',
      text: line.trim().slice(0, 140),
    });
  }
  return findings;
}

function walkFiles(target, root = WORKSPACE_ROOT) {
  const full = path.join(root, target);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return [target];
  const out = [];
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(child, root));
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

export function findUnpaginatedApiQueries(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, ['packages'], {
    scan: 'api-pagination',
    why: 'The pagination floor governs shipped source; reading no source is not finding it paginated.',
  });
  const findings = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const rel of walkFiles(scanRoot, root)) {
      if (!SCANNED_EXTENSIONS.has(path.extname(rel))) continue;
      // This module and its own tests DESCRIBE the forbidden shape in order to detect it.
      const norm = rel.replace(/\\/g, '/');
      if (norm.endsWith('scan-api-pagination.mjs')) continue;
      if (norm.includes('/__tests__/')) continue;
      findings.push(...findUnpaginatedQueries(readFileSync(path.join(root, rel), 'utf8'), norm));
    }
  }
  return findings;
}

function main() {
  const findings = findUnpaginatedApiQueries();
  if (findings.length === 0) {
    console.log('api-pagination scan passed.');
    process.exit(0);
  }
  console.error('api-pagination scan FAILED — a paginated API is being read one page at a time:');
  for (const finding of findings) {
    console.error(`  [${finding.kind}] ${finding.file}:${finding.line}  ${finding.text}`);
  }
  console.error(
    '\nA single-page read of a paginated endpoint returns a SMALLER number, not an error — its\n' +
      'output is indistinguishable from a clean result. Fix a hit by:\n' +
      '  - routing the read through `scripts/harness/github-api.mjs` (paginates AND asserts the\n' +
      '    record count against the API total), OR\n' +
      '  - adding `--paginate` to the `gh api` call, OR\n' +
      '  - annotating a genuine single-record existence probe with\n' +
      '    `allow-unpaginated: <why the count is never read>`.',
  );
  process.exit(1);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
