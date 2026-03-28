/**
 * Harness scanner: verify that production source files do not exceed
 * the 300-line limit defined in code-quality.md.
 *
 * Scans all *.ts and *.tsx files under packages/ and apps/,
 * excluding test files and dist/.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { WORKSPACE_ROOT, pathExists } from './shared.mjs';

const MAX_LINES = 300;

const SCAN_ROOTS = ['packages', 'apps'];

const EXCLUDE_PATTERNS = ['__tests__', '.test.', '.spec.', '/dist/', '/node_modules/', 'CHANGELOG'];

function isExcluded(filePath) {
  return EXCLUDE_PATTERNS.some((p) => filePath.includes(p));
}

async function collectSourceFiles(dir) {
  const absDir = path.join(WORKSPACE_ROOT, dir);
  if (!(await pathExists(absDir))) return [];

  const results = [];

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__')
          continue;
        await walk(full);
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        const rel = path.relative(WORKSPACE_ROOT, full);
        if (!isExcluded(rel)) {
          results.push({ absPath: full, relPath: rel });
        }
      }
    }
  }

  await walk(absDir);
  return results;
}

async function main() {
  const findings = [];

  for (const root of SCAN_ROOTS) {
    const files = await collectSourceFiles(root);

    for (const { absPath, relPath } of files) {
      const content = await fs.readFile(absPath, 'utf8');
      const lineCount = content.split('\n').length;

      if (lineCount > MAX_LINES) {
        findings.push({
          file: relPath,
          type: 'file-too-large',
          detail: `${lineCount} lines (max ${MAX_LINES}). Split by responsibility per code-quality.md anti-monolith rule.`,
        });
      }
    }
  }

  if (findings.length === 0) {
    process.stdout.write('harness file-size scan passed.\n');
    return;
  }

  process.stdout.write(
    `harness file-size scan: ${findings.length} file(s) exceed ${MAX_LINES} lines:\n`,
  );
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  // Warning only — does not fail the scan until existing violations are resolved
  // Change to `process.exitCode = 1;` once CLI-BL-022 is complete
}

void main();
