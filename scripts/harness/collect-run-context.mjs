/**
 * collect-run-context.mjs
 *
 * Collects execution context from recent runs for observability:
 * - Strict-policy error extraction from logs
 * - ownerPath flow summary
 * - Scenario verification artifact index
 *
 * Usage:
 *   node scripts/harness/collect-run-context.mjs [--scope <scope>] [--report-file <path>]
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { listWorkspaceScopes, pathExists, readText, readJson } from './shared.mjs';

const WORKSPACE_ROOT = process.cwd();

function parseArgs(argv) {
  const options = { scope: null, reportFile: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--' ) continue;
    if (argv[i] === '--scope') {
      options.scope = argv[++i];
    } else if (argv[i] === '--report-file') {
      options.reportFile = argv[++i];
    }
  }
  return options;
}

async function collectStrictPolicyErrors() {
  const result = spawnSync('grep', [
    '-rn', '--include=*.ts',
    '--exclude-dir=node_modules', '--exclude-dir=dist',
    '-E', '\\[STRICT.POLICY\\]|\\[EMITTER.CONTRACT\\]|\\[APPLY.LAYER\\]',
    'packages/',
  ], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }

  return result.stdout.trim().split(/\r?\n/).map(line => {
    const [file, ...rest] = line.split(':');
    const lineNum = rest[0];
    const content = rest.slice(1).join(':').trim();
    return { file, line: parseInt(lineNum, 10), content };
  });
}

async function collectOwnerPathUsage() {
  const result = spawnSync('grep', [
    '-rn', '--include=*.ts',
    '--exclude-dir=node_modules', '--exclude-dir=dist',
    '-l', 'ownerPath',
    'packages/',
  ], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }

  return result.stdout.trim().split(/\r?\n/);
}

async function collectScenarioArtifacts(scopeFilter) {
  const scopes = await listWorkspaceScopes();
  const artifacts = [];

  for (const scope of scopes) {
    if (scopeFilter && scope.shortName !== scopeFilter && scope.relativeDir !== scopeFilter) {
      continue;
    }

    const scenarioDir = path.join(WORKSPACE_ROOT, scope.relativeDir, 'examples', 'scenarios');
    if (!(await pathExists(scenarioDir))) {
      continue;
    }

    const entries = await fs.readdir(scenarioDir);
    const records = entries.filter(e => e.endsWith('.record.json'));

    for (const record of records) {
      const recordPath = path.join(scenarioDir, record);
      try {
        const data = await readJson(recordPath);
        artifacts.push({
          scope: scope.relativeDir,
          file: path.join(scope.relativeDir, 'examples', 'scenarios', record),
          command: data.command?.rendered ?? 'unknown',
          schemaVersion: data.schemaVersion ?? 'unknown',
          recordedAt: data.recordedAt ?? 'unknown',
        });
      } catch {
        artifacts.push({
          scope: scope.relativeDir,
          file: path.join(scope.relativeDir, 'examples', 'scenarios', record),
          error: 'Failed to parse record JSON',
        });
      }
    }
  }

  return artifacts;
}

async function collectEventPrefixes() {
  const result = spawnSync('grep', [
    '-rn', '--include=*.ts',
    '--exclude-dir=node_modules', '--exclude-dir=dist',
    '-E', "EVENT_PREFIX\\s*=\\s*['\"]",
    'packages/',
  ], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }

  return result.stdout.trim().split(/\r?\n/).map(line => {
    const [file, ...rest] = line.split(':');
    return { file, definition: rest.slice(1).join(':').trim() };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const [strictPolicyErrors, ownerPathFiles, scenarioArtifacts, eventPrefixes] = await Promise.all([
    collectStrictPolicyErrors(),
    collectOwnerPathUsage(),
    collectScenarioArtifacts(args.scope),
    collectEventPrefixes(),
  ]);

  const report = {
    type: 'run-context',
    timestamp: new Date().toISOString(),
    strictPolicyErrorSites: strictPolicyErrors.length,
    ownerPathFileCount: ownerPathFiles.length,
    scenarioArtifactCount: scenarioArtifacts.length,
    eventPrefixCount: eventPrefixes.length,
    strictPolicyErrors,
    ownerPathFiles,
    scenarioArtifacts,
    eventPrefixes,
  };

  // Console summary
  process.stdout.write(`run-context collection complete\n`);
  process.stdout.write(`  strict-policy error sites: ${report.strictPolicyErrorSites}\n`);
  process.stdout.write(`  ownerPath usage files: ${report.ownerPathFileCount}\n`);
  process.stdout.write(`  scenario artifacts: ${report.scenarioArtifactCount}\n`);
  process.stdout.write(`  event prefix definitions: ${report.eventPrefixCount}\n`);

  if (args.reportFile) {
    await fs.writeFile(args.reportFile, JSON.stringify(report, null, 2), 'utf8');
    process.stdout.write(`\nReport written to ${args.reportFile}\n`);
  }
}

void main();
