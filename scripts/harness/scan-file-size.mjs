/**
 * Enforces the 300-line production-file ratchet (HARNESS-DIET-003). Existing debt is frozen in
 * `file-size-baseline.json`; new files may not exceed the limit, and frozen files may not grow.
 * Scope covers packages/apps plus configured harness production files. `--write-baseline` locks in
 * legitimate shrinkage and removes stale debt.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadHarnessConfig } from './harness-config.mjs';
import { WORKSPACE_ROOT, pathExists } from './shared.mjs';

const MAX_LINES = 300;
const BASELINE_PATH = path.join(WORKSPACE_ROOT, 'scripts/harness/file-size-baseline.json');

// ARCH-038 exemptions are earned: only configured files that remain pure re-export lists qualify.
// Load config lazily so the module remains importable in a stripped hermetic test tree.
function loadReexportBarrels() {
  const configured = loadHarnessConfig().fileSizeReexportBarrels;
  return new Map((configured?.files ?? []).map((entry) => [entry.file, entry.reason]));
}

function loadAdditionalScope() {
  return loadHarnessConfig().fileSizeAdditionalScope ?? { exactFiles: [], patterns: [] };
}

/** True when every non-comment statement in `content` is a re-export. */
export function isPureReexportBarrel(content) {
  let inBlockComment = false;
  let inExport = false;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    if (line === '' || line.startsWith('//')) continue;
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      continue;
    }
    if (inExport) {
      if (/^\}\s*from\s+['"].+['"];?$/.test(line)) inExport = false;
      else if (!/^(type\s+)?[A-Za-z_$][\w$]*(\s+as\s+[A-Za-z_$][\w$]*)?,?$/.test(line))
        return false;
      continue;
    }
    if (/^export\s+(type\s+)?\*/.test(line)) continue;
    if (/^export\s+(type\s+)?\{[^}]*\}\s*from\s+['"].+['"];?$/.test(line)) continue;
    if (/^export\s+(type\s+)?\{$/.test(line)) {
      inExport = true;
      continue;
    }
    return false;
  }
  return !inExport;
}

const SCAN_ROOTS = ['packages', 'apps'];

const EXCLUDE_PATTERNS = ['__tests__', '.test.', '.spec.', '/dist/', '/node_modules/', 'CHANGELOG'];

function isExcluded(filePath) {
  return EXCLUDE_PATTERNS.some((p) => filePath.includes(p));
}

function patternExpression(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replaceAll('*', '[^/]*');
  return new RegExp(`^${escaped}$`, 'u');
}

export function matchesConfiguredHarnessScope(filePath, scope = {}) {
  if ((scope.exactFiles ?? []).includes(filePath)) return true;
  return (scope.patterns ?? []).some((pattern) => patternExpression(pattern).test(filePath));
}

async function collectSourceFiles(dir, acceptsFile) {
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
      } else if (entry.isFile()) {
        const rel = path.relative(WORKSPACE_ROOT, full);
        if (!isExcluded(rel) && acceptsFile(rel)) results.push({ absPath: full, relPath: rel });
      }
    }
  }

  await walk(absDir);
  return results;
}

/** Pure ratchet evaluation for one measured file. */
function evaluateMeasuredFile({ file, baseline, maxLines, exempt }) {
  const { relPath, lineCount, pureReexport } = file;
  const frozen = baseline[relPath];
  const reason = exempt.get(relPath);
  const findings = [];
  const tightenable = [];

  if (reason !== undefined) {
    if (pureReexport === true) {
      if (frozen !== undefined) tightenable.push(relPath);
      return { findings, tightenable, claimed: true };
    }
    findings.push({
      file: relPath,
      type: 'reexport-barrel-exemption-unearned',
      detail:
        `listed as a pure re-export barrel (${reason}), but it contains statements that are not ` +
        `re-exports. The exemption does not apply and the ${maxLines}-line limit is enforced below; ` +
        `move the code out, or drop the entry.`,
    });
  }

  if (lineCount <= maxLines) {
    if (frozen !== undefined) tightenable.push(relPath);
  } else if (frozen === undefined) {
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
    tightenable.push(relPath);
  }
  return { findings, tightenable, claimed: reason !== undefined };
}

export function evaluateFileSizes(files, baseline, maxLines = MAX_LINES, exempt = new Map()) {
  const findings = [];
  const tightenable = [];
  const seen = new Set();
  const claimed = new Set();

  for (const file of files) {
    const { relPath } = file;
    seen.add(relPath);
    const result = evaluateMeasuredFile({ file, baseline, maxLines, exempt });
    findings.push(...result.findings);
    tightenable.push(...result.tightenable);
    if (result.claimed) claimed.add(relPath);
  }

  // A configured exemption that was not measured protects nothing and is stale.
  for (const [relPath, reason] of exempt) {
    if (claimed.has(relPath)) continue;
    findings.push({
      file: relPath,
      type: 'reexport-barrel-exemption-unused',
      detail: `listed as a pure re-export barrel (${reason}), but this scan measured no such file. Drop the entry.`,
    });
  }

  const stale = Object.keys(baseline).filter((relPath) => !seen.has(relPath));
  return { findings, tightenable, stale };
}

/** HARNESS-052: unlocked shrinkage and stale baseline entries are failures, not notices. */
export function baselineDriftFindings({ tightenable = [], stale = [] } = {}) {
  return [
    ...tightenable.map((relPath) => ({
      file: relPath,
      type: 'ratchet-tighten',
      detail:
        'shrank below its baseline. Run `node scripts/harness/scan-file-size.mjs --write-baseline` ' +
        'in the SAME change so the ratchet keeps the gain — an unlocked gain is a licence to grow ' +
        'back to the old number.',
    })),
    ...stale.map((relPath) => ({
      file: relPath,
      type: 'stale-baseline',
      detail:
        'no longer exists. Run `node scripts/harness/scan-file-size.mjs --write-baseline` — a ' +
        'baseline entry for a deleted file is debt the ratchet can never collect.',
    })),
  ];
}

async function measureAll() {
  const measured = [];
  for (const root of SCAN_ROOTS) {
    const files = await collectSourceFiles(
      root,
      (relPath) => relPath.endsWith('.ts') || relPath.endsWith('.tsx'),
    );
    for (const { absPath, relPath } of files) {
      const content = await fs.readFile(absPath, 'utf8');
      measured.push({
        relPath,
        lineCount: content.split('\n').length,
        pureReexport: isPureReexportBarrel(content),
      });
    }
  }
  const additionalScope = loadAdditionalScope();
  const harnessFiles = await collectSourceFiles('scripts/harness', (relPath) =>
    matchesConfiguredHarnessScope(relPath, additionalScope),
  );
  for (const { absPath, relPath } of harnessFiles) {
    const content = await fs.readFile(absPath, 'utf8');
    measured.push({
      relPath,
      lineCount: content.split('\n').length,
      pureReexport: isPureReexportBarrel(content),
    });
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

  const exemptions = loadReexportBarrels();

  if (process.argv.includes('--write-baseline')) {
    const next = {};
    for (const { relPath, lineCount } of measured.sort((a, b) =>
      a.relPath.localeCompare(b.relPath),
    )) {
      // Earned barrel exemptions carry no frozen debt.
      if (lineCount > MAX_LINES && !exemptions.has(relPath)) next[relPath] = lineCount;
    }
    await fs.writeFile(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    process.stdout.write(
      `file-size baseline regenerated: ${Object.keys(next).length} entr(y/ies) > ${MAX_LINES} lines.\n`,
    );
    return;
  }

  const baseline = await loadBaseline();
  const { findings, tightenable, stale } = evaluateFileSizes(
    measured,
    baseline,
    MAX_LINES,
    exemptions,
  );

  findings.push(...baselineDriftFindings({ tightenable, stale }));

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

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  void main();
}
