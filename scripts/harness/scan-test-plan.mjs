/**
 * Harness scanner: verify that all development planning documents
 * include a test plan section with minimum content.
 *
 * A test plan section is a heading (##/###) that matches a known
 * test-related pattern, followed by at least 50 characters of content
 * before the next heading or end of file.
 *
 * WHICH TREE (HARNESS-052). This gated `docs/superpowers/**` and `.agents/tasks` only, while the
 * LIVE planning pipeline is `.agents/spec-docs/**` — and `check-ghost-package-refs` classifies
 * `docs/superpowers/` as "dated historical plan/spec artifacts", so one guard was treating as live
 * what another treated as history. The spec-doc pipeline is now gated too, and the states are chosen
 * rather than swept:
 *
 *   - `backlog/`, `todo/`, `active/` — GATED. These are post-GATE-WRITE (see spec-docs/README.md),
 *     and `spec-workflow.md` requires every spec change to carry a verification test plan.
 *   - `draft/` — NOT gated. A draft is pre-GATE-WRITE, incomplete by design; failing it would fire
 *     on correct work, and a gate that fires on correct work gets routed around. Measured: 1 of the
 *     3 current drafts would have failed.
 *   - `done/`, `rejected/` — NOT gated. Immutable history; the same exclusion
 *     `check-ghost-package-refs` already applies. Measured: 6 of 237 `done/` documents would have
 *     failed, none of them editable work. Sweeping all 242 files would have been the same defect in
 *     the other direction — a gate firing on records nobody can act on.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { WORKSPACE_ROOT, pathExists } from './shared.mjs';

const MIN_CONTENT_LENGTH = 50;

/** The spec-doc lifecycle folder that MUST exist for this scan to have a subject at all. */
const SPEC_DOCS_ROOT = '.agents/spec-docs';

const SCAN_DIRS = [
  'docs/superpowers/plans',
  'docs/superpowers/specs',
  '.agents/tasks',
  `${SPEC_DOCS_ROOT}/backlog`,
  `${SPEC_DOCS_ROOT}/todo`,
  `${SPEC_DOCS_ROOT}/active`,
];

/** Heading patterns that qualify as a test plan section (case-insensitive). */
const TEST_SECTION_PATTERNS = [
  /^#{2,3}\s+test\s*plan/i,
  /^#{2,3}\s+test\s*strategy/i,
  /^#{2,3}\s+test(ing)?$/i,
  /^#{2,3}\s+테스트/i,
  /^#{2,3}\s+검증/i,
];

/**
 * Check whether a markdown document has a test plan section
 * with at least MIN_CONTENT_LENGTH characters of body text.
 */
export function hasTestPlanSection(content) {
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTestHeading = TEST_SECTION_PATTERNS.some((pattern) => pattern.test(line));
    if (!isTestHeading) continue;

    // Collect body text until the next heading or EOF
    let body = '';
    for (let j = i + 1; j < lines.length; j++) {
      if (/^#{1,3}\s/.test(lines[j])) break;
      body += lines[j] + '\n';
    }

    const trimmed = body.trim();
    if (trimmed.length >= MIN_CONTENT_LENGTH) return true;
  }

  return false;
}

async function collectMarkdownFiles(dir, root = WORKSPACE_ROOT) {
  const absDir = path.join(root, dir);
  if (!(await pathExists(absDir))) return [];

  const IGNORED_FILES = new Set(['README.md', 'TEMPLATE.md']);
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md') && !IGNORED_FILES.has(e.name))
    .map((e) => ({
      absPath: path.join(absDir, e.name),
      relPath: path.join(dir, e.name),
    }));
}

/**
 * Findings plus the number of documents actually read.
 *
 * FAIL-CLOSED on an absent `.agents/spec-docs` (HARNESS-052): every scanned directory was optional,
 * so this scan answered "test-plan scan passed" for a root containing none of them — the
 * pass-over-nothing shape the item catalogues. The spec-doc pipeline is mandatory in this
 * repository; its absence means the scan is somewhere it cannot judge.
 */
export async function collectTestPlanFindings(root = WORKSPACE_ROOT) {
  if (!(await pathExists(path.join(root, SPEC_DOCS_ROOT)))) {
    throw new Error(
      `${SPEC_DOCS_ROOT}/ is missing from ${root}. Every directory this scan reads is optional, so ` +
        'without it a pass would mean "no planning documents were found", which is not the same ' +
        'claim as "every planning document has a test plan" (HARNESS-052).',
    );
  }

  const findings = [];
  let examined = 0;

  for (const dir of SCAN_DIRS) {
    const files = await collectMarkdownFiles(dir, root);

    for (const { absPath, relPath } of files) {
      const content = await fs.readFile(absPath, 'utf8');
      examined += 1;

      if (!hasTestPlanSection(content)) {
        findings.push({
          file: relPath,
          type: 'missing-test-plan',
          detail:
            'Development document must include a test plan section (## Test Plan, ## Test Strategy, ## Testing, ## 테스트, ## 검증) with at least 50 characters of content.',
        });
      }
    }
  }

  return { findings, examined };
}

async function main() {
  const { findings, examined } = await collectTestPlanFindings();

  if (findings.length === 0) {
    // The count is reported because "passed" over 26 documents and "passed" over none read the same.
    process.stdout.write(`harness test-plan scan passed (${examined} document(s) checked).\n`);
    return;
  }

  process.stdout.write('harness test-plan scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

// Only when RUN, not when imported: `void main()` at module scope meant importing this scan for its
// pure helpers executed a full pass over the live tree — including from other scans' measurement
// harnesses, where the side effect is an unrelated process writing to stdout and setting exit codes.
const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}
