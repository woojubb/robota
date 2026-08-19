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
import { loadHarnessConfig } from './harness-config.mjs';
import { WORKSPACE_ROOT, pathExists } from './shared.mjs';

const MAX_LINES = 300;
const BASELINE_PATH = path.join(WORKSPACE_ROOT, 'scripts/harness/file-size-baseline.json');

/**
 * ARCH-038: the files exempt from the line limit because they are PURE RE-EXPORT LISTS.
 *
 * A barrel is not a monolith in the sense the anti-monolith rule means. `sdk-public-surface` refuses
 * `export *` — rightly, it is what keeps the published surface auditable — so every public name costs
 * one line wherever it is listed, and a sub-barrel moves lines without removing any. Treating that as
 * debt is what pushed ARCH-029 to regenerate the baseline instead, and adopting debt quietly is
 * indistinguishable from adopting a refactor.
 *
 * The exemption is EARNED, not declared: a listed file is exempt only while
 * {@link isPureReexportBarrel} holds for it. The moment a listed barrel grows a function, a constant
 * or an import, the exemption stops applying and the limit is enforced again — reported as
 * `reexport-barrel-exemption-unearned` rather than silently. A named exemption nothing verifies is
 * the same defect as a guard that cannot fire, one level up.
 */
/**
 * Read LAZILY, not at module load. The hermetic tier runs this file's tests in a stripped tree with
 * no `.agents/harness.config.json`, and a top-level read makes merely IMPORTING the module throw
 * there — a scan that cannot be loaded is a scan that cannot run, which the tier reports as a broken
 * checkout rather than as the config coupling it is.
 */
function loadReexportBarrels() {
  const configured = loadHarnessConfig().fileSizeReexportBarrels;
  return new Map((configured?.files ?? []).map((entry) => [entry.file, entry.reason]));
}

/**
 * True when every statement in `content` is a re-export.
 *
 * Blank lines, `//` comments and block comments are ignored — a barrel has to be able to say why it
 * exists. Everything else must belong to an `export … from '…'` statement, including the continuation
 * lines of a multi-line one. An `import`, a `const`, a `function` or a local `type` means the file is
 * doing work, and work is what the size limit is about.
 */
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
      // The closing line of a multi-line re-export names its module; a bare `}` does not end one.
      if (/^\}\s*from\s+['"].+['"];?$/.test(line)) inExport = false;
      // `type X,` inside a value re-export block is still a re-export — TypeScript allows the
      // per-specifier form, and the barrel uses it.
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
export function evaluateFileSizes(files, baseline, maxLines = MAX_LINES, exempt = new Map()) {
  const findings = [];
  const tightenable = [];
  const seen = new Set();
  const claimed = new Set();

  for (const { relPath, lineCount, pureReexport } of files) {
    seen.add(relPath);
    const frozen = baseline[relPath];
    const reason = exempt.get(relPath);

    if (reason !== undefined) {
      claimed.add(relPath);
      // The exemption is EARNED. A listed barrel that has grown real code is judged like any other
      // file AND is reported, because the entry now says something untrue about it.
      if (pureReexport === true) {
        if (frozen !== undefined) tightenable.push(relPath); // an exempt file needs no frozen count
        continue;
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

  // An entry naming a file the scan never measured is an exemption that protects nothing, and it
  // reads in review as if it did. Same shape as a stale baseline row.
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

/**
 * Baseline drift — a shrunk file whose gain is not locked in, or an entry for a file that is gone.
 *
 * HARNESS-052 (sub-shape B, the one this item found by reading rather than measuring). Both were
 * printed and then exit 0: 21 advisory lines on EVERY run, which is how a ratchet loosens. "Regenerate
 * in the same PR" was a request, so 21 files kept a standing licence to grow back to the number they
 * had already beaten, and the notices themselves became scenery. They are findings now, exactly as
 * `check-test-module-mocks` treats its stale entries — and the remedy is one command, printed with
 * the finding, so the cost of the failure is bounded.
 */
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
    const files = await collectSourceFiles(root);
    for (const { absPath, relPath } of files) {
      const content = await fs.readFile(absPath, 'utf8');
      measured.push({
        relPath,
        lineCount: content.split('\n').length,
        // Computed for every file, not only the listed ones, so a case can feed the evaluator a file
        // whose exemption is claimed and unearned without the reader having to fake the flag.
        pureReexport: isPureReexportBarrel(content),
      });
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

  const exemptions = loadReexportBarrels();

  if (process.argv.includes('--write-baseline')) {
    const next = {};
    for (const { relPath, lineCount } of measured.sort((a, b) =>
      a.relPath.localeCompare(b.relPath),
    )) {
      // An exempt barrel is never frozen: a count for a file the limit does not apply to is debt the
      // ratchet can never collect, and it would reappear on every regeneration.
      if (lineCount > MAX_LINES && !exemptions.has(relPath)) next[relPath] = lineCount;
    }
    await fs.writeFile(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    process.stdout.write(
      `file-size baseline regenerated: ${Object.keys(next).length} entr(y/ies) > ${MAX_LINES} lines.\n`,
    );
    return;
  }

  const baseline = await loadBaseline();
  // The live exemptions are passed IN rather than defaulted inside the evaluator, so the pure
  // function stays a function of its arguments and a case cannot be surprised by repository config.
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
