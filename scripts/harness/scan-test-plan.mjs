/**
 * Harness scanner: verify that all development planning documents
 * include a test plan section with minimum content.
 *
 * Scans:
 *   - docs/superpowers/plans/*.md
 *   - docs/superpowers/specs/*.md
 *   - .agents/tasks/*.md  (excluding completed/)
 *
 * A test plan section is a heading (##/###) that matches a known
 * test-related pattern, followed by at least 50 characters of content
 * before the next heading or end of file.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { WORKSPACE_ROOT, pathExists } from './shared.mjs';

const MIN_CONTENT_LENGTH = 50;

const SCAN_DIRS = ['docs/superpowers/plans', 'docs/superpowers/specs', '.agents/tasks'];

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

async function collectMarkdownFiles(dir) {
  const absDir = path.join(WORKSPACE_ROOT, dir);
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

async function main() {
  const findings = [];

  for (const dir of SCAN_DIRS) {
    const files = await collectMarkdownFiles(dir);

    for (const { absPath, relPath } of files) {
      const content = await fs.readFile(absPath, 'utf8');

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

  if (findings.length === 0) {
    process.stdout.write('harness test-plan scan passed.\n');
    return;
  }

  process.stdout.write('harness test-plan scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

void main();
