/**
 * Harness scanner: verify that production source files do not exceed the 300-line limit defined in
 * code-quality.md — ENFORCED as a RATCHET (HARNESS-DIET-003).
 *
 * The scan was warn-only for a year and could never fail (vacuous gate) while ~100 files grew past the
 * limit. Deleting the debt at once is not realistic, and raising the limit would make the rule
 * meaningless, so this uses the repo's standard burn-down pattern (cf. the MOCK-001 allowlist):
 *
 *   - `file-size-baseline.json` records every pre-existing violator WITH its line count at adoption.
 *   - A file NOT in the baseline must be ≤ MAX_LINES — new monoliths FAIL immediately.
 *   - A baselined file may not GROW past its recorded count — existing debt is frozen, not licensed.
 *   - Shrinking is always allowed; when a baselined file drops to ≤ MAX_LINES (or below its recorded
 *     count), the scan prints a ratchet-tightening notice — regenerate with `--write-baseline` in the
 *     same PR so the ratchet only ever tightens.
 *
 * `--write-baseline` regenerates the baseline from the current tree (for adopting a legitimate refactor).
 * Scans all *.ts and *.tsx files under packages/ and apps/, excluding test files and dist/.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { WORKSPACE_ROOT, pathExists } from './shared.mjs';

const MAX_LINES = 300;
const BASELINE_PATH = path.join(WORKSPACE_ROOT, 'scripts/harness/file-size-baseline.json');

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

/**
 * Pure ratchet evaluation (exposed for tests).
 * @param {Array<{relPath: string, lineCount: number}>} files
 * @param {Record<string, number>} baseline  relPath → line count frozen at adoption
 * @param {number} maxLines
 * @returns {{findings: Array<{file, type, detail}>, tightenable: string[], stale: string[]}}
 */
export function evaluateFileSizes(files, baseline, maxLines = MAX_LINES) {
  const findings = [];
  const tightenable = [];
  const seen = new Set();

  for (const { relPath, lineCount } of files) {
    seen.add(relPath);
    const frozen = baseline[relPath];

    if (lineCount <= maxLines) {
      if (frozen !== undefined) tightenable.push(relPath); // burned down below the limit — drop from baseline
      continue;
    }

    if (frozen === undefined) {
      findings.push({
        file: relPath,
        type: 'file-too-large',
        detail: `${lineCount} lines (max ${maxLines}, not baselined). Split by responsibility per code-quality.md anti-monolith rule.`,
      });
    } else if (lineCount > frozen) {
      findings.push({
        file: relPath,
        type: 'file-grew-past-baseline',
        detail: `${lineCount} lines (baseline froze it at ${frozen}). Pre-existing debt may shrink but never grow — split instead of extending.`,
      });
    } else if (lineCount < frozen) {
      tightenable.push(relPath); // shrank — ratchet can tighten to the new count
    }
  }

  const stale = Object.keys(baseline).filter((relPath) => !seen.has(relPath));
  return { findings, tightenable, stale };
}

async function measureAll() {
  const measured = [];
  for (const root of SCAN_ROOTS) {
    const files = await collectSourceFiles(root);
    for (const { absPath, relPath } of files) {
      const content = await fs.readFile(absPath, 'utf8');
      measured.push({ relPath, lineCount: content.split('\n').length });
    }
  }
  return measured;
}

async function loadBaseline() {
  try {
    return JSON.parse(await fs.readFile(BASELINE_PATH, 'utf8'));
  } catch {
    return {}; // no baseline file → everything over the limit fails (the strictest mode)
  }
}

async function main() {
  const measured = await measureAll();

  if (process.argv.includes('--write-baseline')) {
    const next = {};
    for (const { relPath, lineCount } of measured.sort((a, b) =>
      a.relPath.localeCompare(b.relPath),
    )) {
      if (lineCount > MAX_LINES) next[relPath] = lineCount;
    }
    await fs.writeFile(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    process.stdout.write(
      `file-size baseline regenerated: ${Object.keys(next).length} entr(y/ies) > ${MAX_LINES} lines.\n`,
    );
    return;
  }

  const baseline = await loadBaseline();
  const { findings, tightenable, stale } = evaluateFileSizes(measured, baseline);

  for (const relPath of tightenable) {
    process.stdout.write(
      `- [ratchet-tighten] ${relPath} shrank below its baseline — run \`node scripts/harness/scan-file-size.mjs --write-baseline\` to lock in the gain.\n`,
    );
  }
  for (const relPath of stale) {
    process.stdout.write(
      `- [stale-baseline] ${relPath} no longer exists — regenerate the baseline.\n`,
    );
  }

  if (findings.length === 0) {
    process.stdout.write(
      `harness file-size scan passed (${Object.keys(baseline).length} baselined burn-down entries).\n`,
    );
    return;
  }

  process.stdout.write(`harness file-size scan: ${findings.length} finding(s):\n`);
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
