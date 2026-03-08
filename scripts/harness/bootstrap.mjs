import { promises as fs } from 'node:fs';
import path from 'node:path';

import { WORKSPACE_ROOT, pathExists, readJson, runCommand } from './shared.mjs';

const APP_DEFINITIONS = [
  { name: 'web', dir: 'apps/web', buildCommand: 'build' },
  { name: 'api-server', dir: 'apps/api-server', buildCommand: 'build' },
];

function parseBootstrapArgs(argv) {
  const options = { scope: null, reportFile: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--') continue;
    if (argv[i] === '--scope') { options.scope = argv[++i]; }
    else if (argv[i] === '--report-file') { options.reportFile = argv[++i]; }
    else if (argv[i] === '--dry-run') { options.dryRun = true; }
  }
  return options;
}

async function main() {
  const options = parseBootstrapArgs(process.argv.slice(2));

  const apps = options.scope
    ? APP_DEFINITIONS.filter((app) => app.name === options.scope)
    : APP_DEFINITIONS;

  if (apps.length === 0) {
    process.stdout.write(`Unknown app scope: ${options.scope}\n`);
    process.stdout.write(`Available apps: ${APP_DEFINITIONS.map((app) => app.name).join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  const results = [];
  let allPassed = true;

  for (const app of apps) {
    const workdir = path.join(WORKSPACE_ROOT, app.dir);
    const dirExists = await pathExists(workdir);

    if (!dirExists) {
      process.stdout.write(`\n[bootstrap] ${app.dir} — directory not found, skipping\n`);
      results.push({ name: app.name, dir: app.dir, status: 'skip', reason: 'directory not found' });
      continue;
    }

    const packageJsonPath = path.join(workdir, 'package.json');
    if (!(await pathExists(packageJsonPath))) {
      process.stdout.write(`\n[bootstrap] ${app.dir} — no package.json, skipping\n`);
      results.push({ name: app.name, dir: app.dir, status: 'skip', reason: 'no package.json' });
      continue;
    }

    const packageJson = await readJson(packageJsonPath);
    const scripts = typeof packageJson.scripts === 'object' && packageJson.scripts !== null
      ? packageJson.scripts
      : {};

    if (!scripts[app.buildCommand]) {
      process.stdout.write(`\n[bootstrap] ${app.dir} — no "${app.buildCommand}" script, skipping\n`);
      results.push({ name: app.name, dir: app.dir, status: 'skip', reason: `no ${app.buildCommand} script` });
      continue;
    }

    process.stdout.write(`\n[bootstrap] ${app.dir}\n`);

    try {
      runCommand('pnpm', [app.buildCommand], workdir, options.dryRun);
      results.push({ name: app.name, dir: app.dir, status: 'pass' });
    } catch {
      results.push({ name: app.name, dir: app.dir, status: 'fail' });
      allPassed = false;
    }
  }

  process.stdout.write('\nBootstrap summary:\n');
  for (const result of results) {
    const icon = result.status === 'pass' ? 'PASS' : result.status === 'fail' ? 'FAIL' : 'SKIP';
    const suffix = result.reason ? ` (${result.reason})` : '';
    process.stdout.write(`  [${icon}] ${result.dir}${suffix}\n`);
  }

  process.stdout.write(`\nOverall: ${allPassed ? 'PASSED' : 'FAILED'}\n`);

  if (options.reportFile) {
    const reportPayload = {
      type: 'bootstrap',
      timestamp: new Date().toISOString(),
      apps: results.map((result) => ({
        name: result.name,
        dir: result.dir,
        status: result.status,
        ...(result.reason ? { reason: result.reason } : {}),
      })),
      passed: allPassed,
    };

    const targetPath = path.resolve(WORKSPACE_ROOT, options.reportFile);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, `${JSON.stringify(reportPayload, null, 2)}\n`, 'utf8');

    const relativePath = path.relative(WORKSPACE_ROOT, targetPath);
    process.stdout.write(`Report written: ${relativePath.startsWith('..') ? targetPath : relativePath}\n`);
  }

  if (!allPassed) {
    process.exitCode = 1;
  }
}

void main();
