#!/usr/bin/env node

/**
 * Manage release-run state artifacts for release and publish operations.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = process.cwd();
const RELEASE_RUNS_DIR = '.agents/release-runs';

const REQUIRED_FIELDS = [
  'Version',
  'Branch',
  'SHA',
  'PR',
  'Target branch',
  'Active gate',
  'Gate status',
  'Next action',
  'Stop condition',
  'Publish ready',
  'Active watchers',
  'Cleanup status',
];

const REQUIRED_TRIAGE_FIELDS = [
  'PR',
  'Check',
  'Failure class',
  'Failure signature',
  'Local reproduction',
  'Owning layer',
  'Minimal fix recommendation',
  'Validation gate',
  'Status',
];

const GATE_STATUSES = new Set(['pending', 'running', 'passed', 'failed', 'stalled', 'skipped']);
const YES_NO = new Set(['yes', 'no']);
const CLEAN_WATCHER_VALUES = new Set(['none', 'clear', 'cleared', 'no active watchers']);
const CLEANUP_VALUES = new Set(['clear', 'cleared']);
const CLOSED_TRIAGE_STATUSES = new Set(['resolved', 'closed', 'deferred']);

function normalizeKey(key) {
  return key.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeValue(value) {
  return value.trim().replace(/\s+/g, ' ');
}

function isPlaceholder(value) {
  const normalized = normalizeValue(value).toLowerCase();
  return (
    normalized.length === 0 ||
    normalized === 'tbd' ||
    normalized === 'todo' ||
    normalized === 'unknown' ||
    /^<[^>]+>$/.test(normalized)
  );
}

function getField(fields, key) {
  return fields.get(normalizeKey(key));
}

function setField(fields, key, value) {
  fields.set(normalizeKey(key), normalizeValue(value));
}

function parseKeyValueLine(line) {
  const match = /^-\s+([^:]+):\s*(.*)$/.exec(line);
  if (!match) {
    return undefined;
  }
  return {
    key: match[1],
    value: match[2],
  };
}

export function parseReleaseRun(content, file = '<memory>') {
  const fields = new Map();
  const triageNotes = [];
  let currentSection = '';
  let currentTriage;

  for (const line of content.split(/\r?\n/)) {
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      currentSection = normalizeValue(h2[1]);
      currentTriage = undefined;
      continue;
    }

    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) {
      if (currentSection === 'CI Triage Notes') {
        currentTriage = {
          title: normalizeValue(h3[1]),
          fields: new Map(),
        };
        triageNotes.push(currentTriage);
      } else {
        currentTriage = undefined;
      }
      continue;
    }

    const keyValue = parseKeyValueLine(line);
    if (!keyValue) {
      continue;
    }

    if (currentTriage) {
      setField(currentTriage.fields, keyValue.key, keyValue.value);
      continue;
    }

    setField(fields, keyValue.key, keyValue.value);
  }

  return {
    file,
    fields,
    triageNotes,
  };
}

function fieldFinding(run, field, detail) {
  return {
    file: run.file,
    detail: `${field}: ${detail}`,
  };
}

function validateRequiredFields(run) {
  const findings = [];

  for (const field of REQUIRED_FIELDS) {
    const value = getField(run.fields, field);
    if (value === undefined) {
      findings.push(fieldFinding(run, field, 'required release-run field is missing.'));
      continue;
    }

    if (field !== 'PR' && isPlaceholder(value)) {
      findings.push(fieldFinding(run, field, 'required release-run field must be concrete.'));
    }
  }

  const gateStatus = getField(run.fields, 'Gate status');
  if (gateStatus !== undefined && !GATE_STATUSES.has(gateStatus.toLowerCase())) {
    findings.push(
      fieldFinding(
        run,
        'Gate status',
        `must be one of ${[...GATE_STATUSES].join(', ')}; found ${gateStatus}.`,
      ),
    );
  }

  const publishReady = getField(run.fields, 'Publish ready');
  if (publishReady !== undefined && !YES_NO.has(publishReady.toLowerCase())) {
    findings.push(fieldFinding(run, 'Publish ready', 'must be yes or no.'));
  }

  return findings;
}

function validateTriageNotes(run, options) {
  const findings = [];

  for (const triageNote of run.triageNotes) {
    for (const field of REQUIRED_TRIAGE_FIELDS) {
      const value = getField(triageNote.fields, field);
      if (value === undefined) {
        findings.push({
          file: run.file,
          detail: `${triageNote.title}: ${field} is missing from the triage note.`,
        });
        continue;
      }

      if (options.publish && isPlaceholder(value)) {
        findings.push({
          file: run.file,
          detail: `${triageNote.title}: ${field} must be resolved before publish.`,
        });
      }
    }

    const status = getField(triageNote.fields, 'Status');
    if (options.publish && status && !CLOSED_TRIAGE_STATUSES.has(status.toLowerCase())) {
      findings.push({
        file: run.file,
        detail: `${triageNote.title}: Status must be resolved, closed, or deferred before publish.`,
      });
    }
  }

  return findings;
}

function validatePublishReadiness(run) {
  const findings = [];
  const gateStatus = getField(run.fields, 'Gate status')?.toLowerCase();
  const publishReady = getField(run.fields, 'Publish ready')?.toLowerCase();
  const activeWatchers = getField(run.fields, 'Active watchers')?.toLowerCase();
  const cleanupStatus = getField(run.fields, 'Cleanup status')?.toLowerCase();

  if (gateStatus !== 'passed') {
    findings.push(fieldFinding(run, 'Gate status', 'must be passed before publish.'));
  }

  if (publishReady !== 'yes') {
    findings.push(fieldFinding(run, 'Publish ready', 'must be yes before publish.'));
  }

  if (!activeWatchers || !CLEAN_WATCHER_VALUES.has(activeWatchers)) {
    findings.push(
      fieldFinding(run, 'Active watchers', 'must be none/clear before publish asks for OTP.'),
    );
  }

  if (!cleanupStatus || !CLEANUP_VALUES.has(cleanupStatus)) {
    findings.push(fieldFinding(run, 'Cleanup status', 'must be clear before publish.'));
  }

  return findings;
}

export function validateReleaseRun(run, options = {}) {
  return [
    ...validateRequiredFields(run),
    ...validateTriageNotes(run, options),
    ...(options.publish ? validatePublishReadiness(run) : []),
  ];
}

function sanitizeVersion(version) {
  return version.replace(/[^0-9A-Za-z._-]/g, '-');
}

export function releaseRunPathForVersion(version) {
  return path.join(RELEASE_RUNS_DIR, `${sanitizeVersion(version)}.md`);
}

function gitOutput(args, fallback) {
  try {
    return execFileSync('git', args, {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return fallback;
  }
}

export function renderReleaseRun(options) {
  const version = options.version;
  const branch = options.branch ?? gitOutput(['branch', '--show-current'], 'unknown');
  const sha = options.sha ?? gitOutput(['rev-parse', '--short=12', 'HEAD'], 'unknown');
  const pr = options.pr ?? 'none';
  const targetBranch = options.targetBranch ?? options['target-branch'] ?? 'main';
  const activeGate = options.activeGate ?? options['active-gate'] ?? 'initialized';
  const gateStatus = options.gateStatus ?? options['gate-status'] ?? 'pending';
  const nextAction =
    options.nextAction ?? options['next-action'] ?? 'Run release-grade verification.';
  const stopCondition =
    options.stopCondition ??
    options['stop-condition'] ??
    'Stop if the active gate fails or stalls.';

  return `# Release Run: ${version}

## State

- Version: ${version}
- Branch: ${branch}
- SHA: ${sha}
- PR: ${pr}
- Target branch: ${targetBranch}
- Active gate: ${activeGate}
- Gate status: ${gateStatus}
- Next action: ${nextAction}
- Stop condition: ${stopCondition}

## Publish Gate

- Publish ready: no
- NPM auth verified: no
- Dry run passed: no
- OTP requested: no

## Long-Running Watchers

- Active watchers: none
- Cleanup status: clear

## CI Triage Notes

<!-- Append notes with pnpm harness:release:triage -- --version ${version} --pr <number> --check <name>. -->

## Final Report

- Merged PRs: TBD
- Published version: ${version}
- Validation gates: TBD
- Skipped checks: none
`;
}

export function buildTriageNote(options) {
  const now = new Date().toISOString();
  const pr = options.pr ?? 'TBD';
  const check = options.check ?? 'TBD';
  const failureClass = options.failureClass ?? options['failure-class'] ?? options.class ?? 'TBD';
  const signature = options.signature ?? 'TBD';
  const localReproduction =
    options.localReproduction ?? options['local-reproduction'] ?? options.local ?? 'TBD';
  const owner = options.owner ?? 'TBD';
  const fix = options.fix ?? options['minimal-fix'] ?? 'TBD';
  const validation = options.validation ?? options['validation-gate'] ?? 'TBD';
  const status = options.status ?? 'open';

  return `### Triage ${now}

- PR: ${pr}
- Check: ${check}
- Failure class: ${failureClass}
- Failure signature: ${signature}
- Local reproduction: ${localReproduction}
- Owning layer: ${owner}
- Minimal fix recommendation: ${fix}
- Validation gate: ${validation}
- Status: ${status}
`;
}

function parseArgs(rawArgs) {
  const args = rawArgs.filter((arg) => arg !== '--');
  const command = args.shift();
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      continue;
    }

    const withoutPrefix = arg.slice(2);
    const equalsIndex = withoutPrefix.indexOf('=');
    if (equalsIndex >= 0) {
      options[withoutPrefix.slice(0, equalsIndex)] = withoutPrefix.slice(equalsIndex + 1);
      continue;
    }

    const nextArg = args[index + 1];
    if (nextArg === undefined || nextArg.startsWith('--')) {
      options[withoutPrefix] = true;
      continue;
    }

    options[withoutPrefix] = nextArg;
    index += 1;
  }

  return { command, options };
}

async function readReleaseRunForVersion(version) {
  const relativePath = releaseRunPathForVersion(version);
  const absolutePath = path.join(WORKSPACE_ROOT, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Release-run file not found: ${relativePath}`);
  }

  const content = await readFile(absolutePath, 'utf8');
  return parseReleaseRun(content, relativePath);
}

async function listReleaseRunFiles() {
  const absoluteDir = path.join(WORKSPACE_ROOT, RELEASE_RUNS_DIR);
  if (!existsSync(absoluteDir)) {
    return [];
  }

  const entries = await readdir(absoluteDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(RELEASE_RUNS_DIR, entry.name))
    .filter((relativePath) => relativePath.endsWith('.md'))
    .filter((relativePath) => path.basename(relativePath) !== 'README.md')
    .sort();
}

async function initReleaseRun(options) {
  if (!options.version || options.version === true) {
    throw new Error('Missing required --version <version>.');
  }

  const relativePath = releaseRunPathForVersion(options.version);
  const absolutePath = path.join(WORKSPACE_ROOT, relativePath);
  if (existsSync(absolutePath) && !options.force) {
    throw new Error(`Release-run file already exists: ${relativePath}`);
  }

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, renderReleaseRun(options), 'utf8');
  process.stdout.write(`created ${relativePath}\n`);
}

async function checkReleaseRun(options) {
  if (options.publish && (!options.version || options.version === true)) {
    throw new Error('Publish checks require --version <version>.');
  }

  const runs = [];
  if (options.version && options.version !== true) {
    runs.push(await readReleaseRunForVersion(options.version));
  } else {
    for (const relativePath of await listReleaseRunFiles()) {
      const content = await readFile(path.join(WORKSPACE_ROOT, relativePath), 'utf8');
      runs.push(parseReleaseRun(content, relativePath));
    }
  }

  if (runs.length === 0) {
    process.stdout.write('release-run check passed: no release-run files to validate.\n');
    return;
  }

  const findings = runs.flatMap((run) =>
    validateReleaseRun(run, { publish: Boolean(options.publish) }),
  );
  if (findings.length === 0) {
    process.stdout.write('release-run check passed.\n');
    return;
  }

  process.stdout.write('release-run check failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

async function triageReleaseRun(options) {
  if (!options.version || options.version === true) {
    throw new Error('Missing required --version <version>.');
  }
  if (!options.pr || options.pr === true) {
    throw new Error('Missing required --pr <number>.');
  }
  if (!options.check || options.check === true) {
    throw new Error('Missing required --check <check-name>.');
  }

  const relativePath = releaseRunPathForVersion(options.version);
  const absolutePath = path.join(WORKSPACE_ROOT, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Release-run file not found: ${relativePath}`);
  }

  const content = await readFile(absolutePath, 'utf8');
  const triageNote = buildTriageNote(options);
  const nextContent = content.includes('## CI Triage Notes')
    ? content.replace(/(## CI Triage Notes\s*\n)/, `$1\n${triageNote}\n`)
    : `${content.trim()}\n\n## CI Triage Notes\n\n${triageNote}\n`;

  await writeFile(absolutePath, nextContent, 'utf8');
  process.stdout.write(`appended triage note to ${relativePath}\n`);
}

async function reportReleaseRun(options) {
  if (!options.version || options.version === true) {
    throw new Error('Missing required --version <version>.');
  }

  const run = await readReleaseRunForVersion(options.version);
  const fields = run.fields;
  process.stdout.write(`Release run ${getField(fields, 'Version') ?? options.version}\n`);
  process.stdout.write(`- Branch: ${getField(fields, 'Branch') ?? 'missing'}\n`);
  process.stdout.write(`- SHA: ${getField(fields, 'SHA') ?? 'missing'}\n`);
  process.stdout.write(`- PR: ${getField(fields, 'PR') ?? 'missing'}\n`);
  process.stdout.write(`- Active gate: ${getField(fields, 'Active gate') ?? 'missing'}\n`);
  process.stdout.write(`- Gate status: ${getField(fields, 'Gate status') ?? 'missing'}\n`);
  process.stdout.write(`- Next action: ${getField(fields, 'Next action') ?? 'missing'}\n`);
  process.stdout.write(`- Stop condition: ${getField(fields, 'Stop condition') ?? 'missing'}\n`);
  process.stdout.write(`- Publish ready: ${getField(fields, 'Publish ready') ?? 'missing'}\n`);
  process.stdout.write(`- Merged PRs: ${getField(fields, 'Merged PRs') ?? 'TBD'}\n`);
  process.stdout.write(`- Published version: ${getField(fields, 'Published version') ?? 'TBD'}\n`);
  process.stdout.write(`- Validation gates: ${getField(fields, 'Validation gates') ?? 'TBD'}\n`);
  process.stdout.write(`- Skipped checks: ${getField(fields, 'Skipped checks') ?? 'none'}\n`);
  process.stdout.write(`- Triage notes: ${run.triageNotes.length}\n`);
}

function printUsage() {
  process.stdout.write(`Usage:
  pnpm harness:release:init -- --version <version> [--target-branch main] [--pr <number>]
  pnpm harness:release:check -- --version <version> [--publish]
  pnpm harness:release:triage -- --version <version> --pr <number> --check <name> [--class <class>] [--signature <text>] [--local <status>] [--owner <path>] [--fix <text>] [--validation <command>]
  pnpm harness:release:report -- --version <version>
`);
}

export async function main(rawArgs = process.argv.slice(2)) {
  const { command, options } = parseArgs(rawArgs);

  try {
    switch (command) {
      case 'init':
        await initReleaseRun(options);
        break;
      case 'check':
        await checkReleaseRun(options);
        break;
      case 'triage':
        await triageReleaseRun(options);
        break;
      case 'report':
        await reportReleaseRun(options);
        break;
      default:
        printUsage();
        process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
