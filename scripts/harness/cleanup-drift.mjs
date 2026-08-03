import fsSync, { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { listWorkspaceScopes, pathExists, readText } from './shared.mjs';

const WORKSPACE_ROOT = process.cwd();
const SKILLS_ROOT = path.join(WORKSPACE_ROOT, '.agents', 'skills');
const SKILLS_INDEX_PATH = path.join(SKILLS_ROOT, 'index.md');
const DESIGN_TMP_PATH = path.join(WORKSPACE_ROOT, '.design', 'tmp');

const SPEC_REQUIRED_SECTIONS = [
  'Scope',
  'Boundaries',
  'Architecture Overview',
  'Type Ownership',
  'Public API Surface',
  'Extension Points',
  'Error Taxonomy',
  'Test Strategy',
];

const FORBIDDEN_AGENT_TERMS = [
  /\bmain agent\b/i,
  /\bsub-agent\b/i,
  /\bparent-agent\b/i,
  /\bchild-agent\b/i,
];

function relativePath(targetPath) {
  return path.relative(WORKSPACE_ROOT, targetPath);
}

function extractSections(content) {
  return [...content.matchAll(/^#{1,4}\s+(.+)$/gm)].map((match) => match[1].trim());
}

async function listSkillDirs() {
  const entries = await fs.readdir(SKILLS_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function extractSkillsFromIndex(content) {
  // skills/index.md is the registry SSOT (AGENTS.md delegates to it). Rows use the
  // markdown link form `[<name>](<name>/SKILL.md)` where link text == directory name.
  const names = new Set();
  for (const match of content.matchAll(/\[([a-z0-9-]+)\]\(\1\/SKILL\.md\)/g)) {
    names.add(match[1]);
  }
  return names;
}

async function checkStaleDesignDocs(findings) {
  if (!(await pathExists(DESIGN_TMP_PATH))) {
    return;
  }

  const entries = await fs.readdir(DESIGN_TMP_PATH);
  const mdFiles = entries.filter((name) => name.endsWith('.md'));

  for (const file of mdFiles) {
    const fullPath = path.join(DESIGN_TMP_PATH, file);
    const stat = await fs.stat(fullPath);
    const ageMs = Date.now() - stat.mtimeMs;
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

    if (ageDays > 14) {
      findings.push({
        file: `.design/tmp/${file}`,
        type: 'stale-tmp-doc',
        detail: `Temporary design document is ${ageDays} days old. Consider promoting to owner doc or removing.`,
      });
    }
  }
}

async function checkSpecQuality(findings) {
  const scopes = await listWorkspaceScopes();

  for (const scope of scopes) {
    const specPath = path.join(WORKSPACE_ROOT, scope.relativeDir, 'docs', 'SPEC.md');
    if (!(await pathExists(specPath))) {
      continue;
    }

    const content = await readText(specPath);
    const sections = extractSections(content);
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

    if (lines.length < 10) {
      findings.push({
        file: path.join(scope.relativeDir, 'docs', 'SPEC.md'),
        type: 'minimal-spec',
        detail: `SPEC.md has only ${lines.length} non-empty lines. Consider expanding per spec-writing-standard skill.`,
      });
    }

    const missingSections = SPEC_REQUIRED_SECTIONS.filter(
      (required) => !sections.some((section) => section.includes(required)),
    );

    if (missingSections.length > 0) {
      findings.push({
        file: path.join(scope.relativeDir, 'docs', 'SPEC.md'),
        type: 'spec-missing-sections',
        detail: `Missing required sections: ${missingSections.join(', ')}`,
      });
    }
  }
}

async function checkUnregisteredSkills(findings) {
  const indexContent = await readText(SKILLS_INDEX_PATH);
  const registeredSkills = extractSkillsFromIndex(indexContent);
  const skillDirs = await listSkillDirs();

  for (const skillDir of skillDirs) {
    if (!registeredSkills.has(skillDir)) {
      findings.push({
        file: `.agents/skills/${skillDir}/`,
        type: 'unregistered-skill',
        detail: `Skill directory exists but is not listed in .agents/skills/index.md (the skills registry).`,
      });
    }
  }

  for (const registered of registeredSkills) {
    if (!skillDirs.includes(registered)) {
      findings.push({
        file: '.agents/skills/index.md',
        type: 'stale-skill-reference',
        detail: `.agents/skills/index.md references skill "${registered}" but no directory exists at .agents/skills/${registered}/.`,
      });
    }
  }
}

async function checkForbiddenTerms(findings) {
  const scopes = await listWorkspaceScopes();

  for (const scope of scopes) {
    const srcDir = path.join(WORKSPACE_ROOT, scope.relativeDir, 'src');
    if (!(await pathExists(srcDir))) {
      continue;
    }

    const result = spawnSync(
      'grep',
      ['-rl', '-E', 'main agent|sub-agent|parent-agent|child-agent', '--include=*.ts', srcDir],
      {
        cwd: WORKSPACE_ROOT,
        encoding: 'utf8',
      },
    );

    if (result.status === 0 && result.stdout.trim().length > 0) {
      const files = result.stdout.trim().split(/\r?\n/);
      for (const file of files) {
        const content = await readText(file);
        for (const term of FORBIDDEN_AGENT_TERMS) {
          if (term.test(content)) {
            findings.push({
              file: relativePath(file),
              type: 'forbidden-agent-term',
              detail: `Contains forbidden agent hierarchy term matching: ${term.source}`,
            });
            break;
          }
        }
      }
    }
  }
}

/**
 * `grep`, with a FAILED measurement told apart from a clean one.
 *
 * Review found the hole: every call site read `result.status !== 0` as "no matches" and moved on,
 * discarding `result.stderr` and `result.error` with it. grep's contract has three outcomes, not two
 * — 0 matched, 1 did not match, **2 or more means grep itself failed**. Conflating the third with the
 * second turns an unreadable directory, a bad regex or a missing binary into a clean bill of health.
 *
 * That is worse here than an ordinary swallowed error, because of what this script now does with the
 * number. Demonstrated with a `grep` stub exiting 2: findings fell 71 → 32 with nothing printed about
 * the failure, and the ratchet reported `drift FELL` and told the operator to re-freeze — so obeying
 * the instruction would have baked zeros into the baseline and permanently disabled three of its four
 * rows. A measurement that failed must never be published as progress.
 */
function grepLines(args, what) {
  const result = spawnSync('grep', args, { cwd: WORKSPACE_ROOT, encoding: 'utf8' });
  if (result.error !== undefined) {
    throw new Error(
      `cleanup-drift: could not run \`grep\` while measuring ${what}: ${result.error}`,
    );
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `cleanup-drift: \`grep\` exited ${result.status} while measuring ${what} — the measurement ` +
        `FAILED, so no drift figure can be reported from it.\n${result.stderr ?? ''}`,
    );
  }
  const output = result.stdout.trim();
  return result.status === 1 || output === '' ? [] : output.split(/\r?\n/);
}

/**
 * The tree this script judges must be there.
 *
 * Three of the four ratchet rows are counted by grepping `packages/`. Over a root without it, grep
 * exits 1 for every pattern, the count is zero, and the verdict reads "drift FELL" — a scan reporting
 * on ground it never examined, which this harness treats as an error and never as a pass.
 */
function requireGovernedTree() {
  if (!fsSync.existsSync(path.join(WORKSPACE_ROOT, 'packages'))) {
    throw new Error(
      `cleanup-drift: packages/ does not exist under ${WORKSPACE_ROOT} — three of the four drift ` +
        'types are counted there, so nothing could be measured.',
    );
  }
}

async function checkBoundaryValidation(findings) {
  // Scan for blind type assertions in production code (not tests)
  const patterns = [
    {
      regex: 'as any',
      type: 'blind-assertion-any',
      detail: 'Blind `as any` assertion in production code.',
    },
    {
      regex: 'as unknown as',
      type: 'blind-assertion-unknown',
      detail: 'Blind `as unknown as T` assertion in production code.',
    },
  ];

  for (const { regex, type, detail } of patterns) {
    const files = grepLines(
      [
        '-rn',
        '--include=*.ts',
        '--exclude-dir=node_modules',
        '--exclude-dir=dist',
        '-l',
        regex,
        'packages/',
      ],
      `\`${regex}\` under packages/`,
    );

    for (const file of files) {
      if (
        file.includes('.test.') ||
        file.includes('.spec.') ||
        file.includes('__tests__') ||
        file.includes('node_modules')
      ) {
        continue;
      }

      findings.push({
        file,
        type,
        detail,
      });
    }
  }

  // A third grep ran here — a coarse "silent fallback" pattern whose result was assigned to a
  // variable and never read, under a comment calling the detection advisory. It spawned a full
  // recursive search of `packages/` on every run and reported nothing to anybody, which is the
  // silence this file is being fixed for wearing its own uniform. Deleted rather than wired up:
  // `scan-no-fallback.mjs` (HARNESS-028) owns that rule with a real gate behind it.
}

async function checkDynamicImports(findings) {
  const lines = grepLines(
    ['-rn', '--include=*.ts', '-E', 'await import\\(|= import\\(', 'packages/'],
    'dynamic imports under packages/',
  );

  for (const line of lines) {
    if (line.includes('.test.') || line.includes('.spec.') || line.includes('__tests__')) {
      continue;
    }

    findings.push({
      file: line.split(':')[0],
      type: 'dynamic-import',
      detail: `Dynamic import detected. Verify this is for an optional module with explicit error handling.`,
    });
  }
}

function parseCleanupArgs(argv) {
  const options = {
    reportFile: null,
    reportFormat: null,
    writeBaseline: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case '--':
        break;
      case '--report-file': {
        const value = argv[index + 1];
        if (!value) {
          throw new Error('--report-file requires a value');
        }
        options.reportFile = value;
        index += 1;
        break;
      }
      case '--report-format': {
        const value = argv[index + 1];
        if (!value) {
          throw new Error('--report-format requires a value');
        }
        if (value !== 'json') {
          throw new Error('--report-format must be: json');
        }
        options.reportFormat = value;
        index += 1;
        break;
      }
      // Read here rather than straight off `process.argv`, so every flag this script honours is
      // owned by one function: the first version tested it inline in `main` and returned early, so
      // `--write-baseline --report-file X` silently wrote no report.
      case '--write-baseline':
        options.writeBaseline = true;
        break;
      default:
        break;
    }
  }

  return options;
}

async function main() {
  const options = parseCleanupArgs(process.argv.slice(2));
  requireGovernedTree();
  const findings = [];

  await Promise.all([
    checkStaleDesignDocs(findings),
    checkSpecQuality(findings),
    checkUnregisteredSkills(findings),
    checkForbiddenTerms(findings),
    checkBoundaryValidation(findings),
    checkDynamicImports(findings),
  ]);

  findings.sort((a, b) => a.type.localeCompare(b.type) || a.file.localeCompare(b.file));

  const driftCount = findings.length;
  const typeGroups = new Map();
  for (const finding of findings) {
    const count = typeGroups.get(finding.type) ?? 0;
    typeGroups.set(finding.type, count + 1);
  }

  process.stdout.write(`harness cleanup drift scan: ${driftCount} finding(s)\n`);
  const verdict = options.writeBaseline
    ? { ok: true, grown: [], shrunk: [] }
    : publishVerdict(typeGroups);

  if (driftCount === 0) {
    process.stdout.write('no drift detected.\n');
  } else {
    process.stdout.write('\nsummary:\n');
    for (const [type, count] of typeGroups) {
      process.stdout.write(`  ${type}: ${count}\n`);
    }

    process.stdout.write('\ndetails:\n');
    for (const finding of findings) {
      process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
    }
  }

  if (options.reportFile) {
    const reportPayload = {
      type: 'cleanup',
      timestamp: new Date().toISOString(),
      findingCount: driftCount,
      findings: findings.map((finding) => ({
        file: finding.file,
        type: finding.type,
        detail: finding.detail,
      })),
      // ONE verdict per run. This field used to read `driftCount === 0` while the exit code read the
      // ratchet, so a run at baseline wrote `passed: false` into a report and exited 0 — two answers
      // to one question, from the same run, disagreeing.
      passed: verdict.ok,
    };

    const targetPath = path.resolve(WORKSPACE_ROOT, options.reportFile);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, `${JSON.stringify(reportPayload, null, 2)}\n`, 'utf8');

    const relativePath = path.relative(WORKSPACE_ROOT, targetPath);
    process.stdout.write(
      `\nReport written: ${relativePath.startsWith('..') ? targetPath : relativePath}\n`,
    );
  }

  // Last, so whoever freezes a baseline has just seen the details and the report they are freezing.
  if (options.writeBaseline) writeDriftBaseline(typeGroups);
}

/**
 * HARNESS-069: publish the verdict this script already computes.
 *
 * It reported findings and exited 0 — no `process.exit`, no `process.exitCode`, zero matches for
 * either. Whatever it found, a caller heard success. The intent was never ambiguous: the JSON report
 * it writes carries `passed: driftCount === 0`, so the verdict existed and simply was not published.
 * "Silence is not success" is a rule of this harness, and this was the one script that could only
 * succeed.
 *
 * A RATCHET rather than a flat gate, for the usual reason: there are findings today (see the frozen
 * baseline), and a check that is red on arrival is suppressed rather than obeyed. The per-type counts
 * may fall and must never rise.
 *
 * WHERE IT IS ENFORCED, stated exactly, because the first version of this comment got it wrong. It is
 * not in `run-all-scans.mjs` and it is in no workflow directly — from which that version concluded
 * "not registered as a gate, and that is deliberate". Review measured the actual path: the ratchet's
 * test asserts this script's exit code against the live tree, `pnpm harness:test` runs the whole
 * `scripts/harness/__tests__` suite, and CI runs `harness:test` unconditionally in the `scans` job.
 * So it IS a required check on every PR — through the test suite rather than the scan registry. A
 * comment asserting the opposite is the defect class this repository measures most often in its own
 * work, and it took one grep of `ci.yml` to disprove.
 *
 * A rise therefore fails CI, and the only ways out are the two a ratchet allows: remove the drift, or
 * change the rule and say so. There is no re-freeze upward.
 */
function publishVerdict(typeGroups) {
  const baseline = loadDriftBaseline();
  if (baseline === undefined) {
    process.stderr.write(
      `no frozen drift baseline — run \`node ${path.relative(WORKSPACE_ROOT, import.meta.filename)} --write-baseline\`.\n`,
    );
    process.exitCode = 1;
    return { ok: false, grown: [], shrunk: [] };
  }

  const grown = [];
  const shrunk = [];
  for (const [type, count] of typeGroups) {
    const frozen = baseline[type] ?? 0;
    if (count > frozen) grown.push(`${type}: ${count} (frozen ${frozen})`);
  }
  for (const [type, frozen] of Object.entries(baseline)) {
    const count = typeGroups.get(type) ?? 0;
    if (count < frozen) shrunk.push(`${type}: ${frozen} → ${count}`);
  }

  if (grown.length > 0) {
    process.stderr.write(`\ndrift GREW: ${grown.join(', ')}\n`);
    process.exitCode = 1;
    return { ok: false, grown, shrunk };
  }
  if (shrunk.length > 0) {
    process.stderr.write(
      `\ndrift FELL (${shrunk.join(', ')}). Re-freeze it in the SAME change — ` +
        `--write-baseline — or the gain is a licence to grow back.\n`,
    );
    process.exitCode = 1;
    return { ok: false, grown, shrunk };
  }
  return { ok: true, grown, shrunk };
}

/**
 * The frozen baseline, overridable for tests.
 *
 * `CLEANUP_DRIFT_BASELINE` exists so the ratchet's own cases can point at a temp file instead of
 * editing the tracked baseline and restoring it in `afterEach` — a restore a timeout or a SIGKILL
 * never runs, leaving the repository's frozen counts corrupted. Same shape as `GUARD_LEDGER_CEILINGS`
 * in `scan-guard-scope-fail-closed.mjs`, for the same reason.
 */
function driftBaselinePath() {
  const override = process.env['CLEANUP_DRIFT_BASELINE'];
  return override !== undefined && override !== ''
    ? path.resolve(WORKSPACE_ROOT, override)
    : path.join(WORKSPACE_ROOT, 'scripts/harness/cleanup-drift-baseline.json');
}

function loadDriftBaseline() {
  try {
    return JSON.parse(fsSync.readFileSync(driftBaselinePath(), 'utf8'));
  } catch (error) {
    // Absent is "never frozen", which the caller reports. Anything else is a real read failure and
    // must not be mistaken for it.
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Freeze the current per-type drift counts. The set may fall and must never rise. */
function writeDriftBaseline(typeGroups) {
  const next = Object.fromEntries([...typeGroups.entries()].sort());
  fsSync.writeFileSync(driftBaselinePath(), `${JSON.stringify(next, null, 2)}\n`);
  process.stdout.write(`drift baseline frozen: ${JSON.stringify(next)}\n`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  void main();
}
