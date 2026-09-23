#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveChangedFiles } from './workspace-affected-git.mjs';
import { WORKSPACE_FULL_FILES } from './classify-changed-paths.mjs';

const WORKSPACE_ROOTS = ['packages', 'apps'];
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];
const GLOBAL_FILES = new Set(['package.json', ...WORKSPACE_FULL_FILES]);
const GLOBAL_PREFIXES = ['.github/workflows/', 'scripts/harness/product-integration-tests.'];

/**
 * Integration/consumer-contract tests whose historic names do not declare their execution shape.
 * Keep this audited inventory explicit until each file is renamed with an integration/contract
 * token. The external-contribution unit lane consumes the same predicate, so no declared entry can
 * silently run as both trusted same-repository integration work and untrusted fork unit work.
 */
export const AUDITED_PRODUCT_INTEGRATION_TESTS = Object.freeze([
  'apps/agent-server/src/__tests__/app.test.ts',
  'apps/agent-server/src/__tests__/remote-chat-stream.test.ts',
  'apps/agent-server/src/__tests__/websocket-server.test.ts',
  'apps/dag-runtime-server/src/__tests__/http-provider.roundtrip.test.ts',
  'apps/remote-signaling/src/__tests__/relay.test.ts',
  'apps/remote-signaling/src/__tests__/server-caps.test.ts',
  'packages/agent-cli/src/__tests__/cli-exit-codes.test.ts',
  'packages/agent-cli/src/__tests__/ws-command-host-action.test.ts',
  'packages/agent-cli/src/__tests__/ws-multi-surface-exit-policy.test.ts',
  'packages/agent-cli/src/modes/__tests__/serve-monitor-ui.test.ts',
  'packages/agent-cli/src/remote-control/__tests__/local-peer-channel.test.ts',
  'packages/agent-cli/src/session-analyzer/__tests__/session-analyze-command.test.ts',
  'packages/agent-core/src/hooks/__tests__/http-executor.test.ts',
  'packages/agent-command/src/git/__tests__/git-command-module.test.ts',
  'packages/agent-command-workflows/src/__tests__/workspace-writer.test.ts',
  'packages/agent-builtin-providers/src/deepseek-provider-demo.test.ts',
  'packages/agent-framework/src/__tests__/cross-package-hooks.test.ts',
  'packages/agent-framework/src/__tests__/cross-package-skills.test.ts',
  'packages/agent-framework/src/__tests__/history-cross-package.test.ts',
  'packages/agent-framework/src/interactive/__tests__/interactive-session-background-tasks.test.ts',
  'packages/agent-framework/src/interactive/__tests__/interactive-session-memory.test.ts',
  'packages/agent-framework/src/interactive/__tests__/interactive-session-prompt-flow.test.ts',
  'packages/agent-framework/src/interactive/__tests__/plan-mode-wiring.test.ts',
  'packages/agent-framework/src/orchestration/__tests__/group-chat.test.ts',
  'packages/agent-framework/src/orchestration/__tests__/handoff.test.ts',
  'packages/agent-framework/src/orchestration/__tests__/hierarchical.test.ts',
  'packages/agent-framework/src/orchestration/__tests__/parallel.test.ts',
  'packages/agent-framework/src/orchestration/__tests__/sequential.test.ts',
  'packages/agent-interface-tui/src/__tests__/command-interaction.test.ts',
  'packages/agent-session/src/__tests__/compaction-failure-preservation.test.ts',
  'packages/agent-remote-pairing/src/local/__tests__/peer-credential.test.ts',
  'packages/agent-subagent-runner/src/__tests__/worker-composition.test.ts',
  'packages/agent-transport-ws/src/__tests__/ws-transport-auth.test.ts',
  'packages/agent-transport-ws/src/__tests__/ws-transport-lifecycle.test.ts',
  'packages/agent-tool-mcp/src/__tests__/mcp-tool.test.ts',
  'packages/agent-ui-terminal/src/__tests__/TuiInteractionChannel.lifecycle.test.ts',
  'packages/dag-cli/src/__tests__/persistence-store.test.ts',
  'packages/dag-cli/src/__tests__/runs-command.test.ts',
  'packages/dag-cli/src/__tests__/code-node-persistence.test.ts',
  'packages/dag-cli/src/__tests__/studio-http-server-security.test.ts',
  'packages/dag-cli/src/__tests__/studio-http-server.test.ts',
  'packages/dag-framework/src/__tests__/create-dag-framework.test.ts',
  'packages/dag-framework/src/__tests__/prompt-backend.test.ts',
  'packages/dag-framework/src/__tests__/tool-node-run.test.ts',
]);
const AUDITED_PRODUCT_INTEGRATION_TEST_SET = new Set(AUDITED_PRODUCT_INTEGRATION_TESTS);

export function isProductIntegrationTest(file) {
  const normalized = String(file ?? '').replaceAll('\\', '/');
  const basename = path.posix.basename(normalized);
  const segments = normalized.split('/');
  const belongsToDedicatedOrOptInLane = isDedicatedOrOptInTest(normalized);
  return (
    /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(basename) &&
    !belongsToDedicatedOrOptInLane &&
    (AUDITED_PRODUCT_INTEGRATION_TEST_SET.has(normalized) ||
      segments.some((segment) =>
        /(?:^|[._-])(?:integrations?|contracts?|e2e|functional|scenarios?)(?:[._-]|$)/u.test(
          segment,
        ),
      ))
  );
}

function workspaceDirectories(root) {
  const directories = [];
  const visit = (relative) => {
    const absolute = path.join(root, relative);
    if (!existsSync(absolute)) return;
    if (existsSync(path.join(absolute, 'package.json'))) {
      directories.push(relative);
      return;
    }
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue;
      }
      visit(path.posix.join(relative, entry.name));
    }
  };
  for (const workspaceRoot of WORKSPACE_ROOTS) visit(workspaceRoot);
  return directories.sort();
}

function selectedTestFiles(root, relative, predicate) {
  const files = [];
  for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const file = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && !entry.name.startsWith('.')) {
        files.push(...selectedTestFiles(root, file, predicate));
      }
    } else if (entry.isFile() && predicate(file)) {
      files.push(file);
    }
  }
  return files;
}

function isDedicatedOrOptInTest(file) {
  return file
    .split('/')
    .some((segment) => /(?:^|[._-])(?:bintest|live|pty)(?:[._-]|$)/u.test(segment));
}

export function isExternalContributionUnitTest(file) {
  return (
    /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path.posix.basename(file)) &&
    !isDedicatedOrOptInTest(file) &&
    !isProductIntegrationTest(file)
  );
}

function readProductTestInventory(root, predicate) {
  const packages = workspaceDirectories(root).map((directory) => {
    const manifest = JSON.parse(readFileSync(path.join(root, directory, 'package.json'), 'utf8'));
    if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
      throw new Error(`${directory}/package.json has no workspace name`);
    }
    const dependencyNames = new Set();
    for (const field of DEPENDENCY_FIELDS) {
      for (const name of Object.keys(manifest[field] ?? {})) dependencyNames.add(name);
    }
    return {
      name: manifest.name,
      directory,
      dependencyNames: [...dependencyNames].sort(),
      tests: selectedTestFiles(root, directory, predicate).sort(),
    };
  });
  const names = new Set(packages.map(({ name }) => name));
  for (const entry of packages) {
    entry.workspaceDependencies = entry.dependencyNames.filter((name) => names.has(name));
  }
  return packages;
}

export function readProductIntegrationInventory(root) {
  const inventory = readProductTestInventory(root, isProductIntegrationTest);
  const existingOwners = inventory.map(({ directory }) => `${directory}/`);
  const applicableAudit = AUDITED_PRODUCT_INTEGRATION_TESTS.filter((file) =>
    existingOwners.some((directory) => file.startsWith(directory)),
  );
  const selected = new Set(allTests(inventory));
  for (const file of applicableAudit) {
    if (!existsSync(path.join(root, file))) {
      throw new Error(`audited product integration test does not exist: ${file}`);
    }
    if (!selected.has(file)) {
      throw new Error(`audited product integration test is not selected: ${file}`);
    }
  }
  return inventory;
}

export function readExternalContributionUnitInventory(root) {
  return readProductTestInventory(root, isExternalContributionUnitTest);
}

function allTests(packages) {
  return packages.flatMap(({ tests }) => tests).sort();
}

function selectProductTests({ packages, changedFiles }) {
  const files = [...new Set((changedFiles ?? []).map((file) => file.replaceAll('\\', '/')))].sort();
  if (
    files.length === 0 ||
    files.some(
      (file) => GLOBAL_FILES.has(file) || GLOBAL_PREFIXES.some((prefix) => file.startsWith(prefix)),
    )
  ) {
    return {
      mode: 'all',
      reason: files.length === 0 ? 'empty change set' : 'shared input changed',
      tests: allTests(packages),
      packages,
    };
  }

  const owners = new Set();
  for (const file of files) {
    const owner = packages.find(
      (entry) => file === entry.directory || file.startsWith(`${entry.directory}/`),
    );
    if (owner) owners.add(owner.name);
    else if (WORKSPACE_ROOTS.some((prefix) => file.startsWith(`${prefix}/`))) {
      return {
        mode: 'all',
        reason: `unresolved workspace owner: ${file}`,
        tests: allTests(packages),
        packages,
      };
    }
  }
  if (owners.size === 0) {
    return { mode: 'none', reason: 'no product workspace changed', tests: [], packages };
  }

  const dependents = new Map(packages.map(({ name }) => [name, []]));
  for (const entry of packages) {
    for (const dependency of entry.workspaceDependencies)
      dependents.get(dependency).push(entry.name);
  }
  const affected = new Set(owners);
  const queue = [...owners].sort();
  while (queue.length > 0) {
    const current = queue.shift();
    for (const dependent of dependents.get(current) ?? []) {
      if (affected.has(dependent)) continue;
      affected.add(dependent);
      queue.push(dependent);
      queue.sort();
    }
  }
  return {
    mode: 'affected',
    reason: `owners and manifest consumers of ${[...owners].sort().join(', ')}`,
    tests: packages
      .filter(({ name }) => affected.has(name))
      .flatMap(({ tests }) => tests)
      .sort(),
    packages,
  };
}

export function selectProductIntegrationTests({ root, changedFiles }) {
  return {
    ...selectProductTests({ packages: readProductIntegrationInventory(root), changedFiles }),
    lane: 'product-integration',
  };
}

export function selectExternalContributionUnitTests({ root, changedFiles }) {
  return {
    ...selectProductTests({
      packages: readExternalContributionUnitInventory(root),
      changedFiles,
    }),
    lane: 'external-units',
  };
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    headRef: 'HEAD',
    changedFiles: [],
    externalUnits: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (!next) throw new Error(`${token} requires a value`);
      index += 1;
      return next;
    };
    if (token === '--root') options.root = path.resolve(value());
    else if (token === '--base-ref') options.baseRef = value();
    else if (token === '--head-ref') options.headRef = value();
    else if (token === '--changed-file') options.changedFiles.push(value());
    else if (token === '--github-output') options.githubOutput = true;
    else if (token === '--build-targets') options.buildTargets = true;
    else if (token === '--external-units') options.externalUnits = true;
    else if (token === '--list') options.list = true;
    else throw new Error(`unknown argument: ${token}`);
  }
  return options;
}

function completedStatus(result) {
  if (result && typeof result.once === 'function') {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (status) => {
        if (settled) return;
        settled = true;
        resolve(status);
      };
      result.once('error', () => finish(1));
      result.once('exit', (status, signal) => finish(signal ? 1 : (status ?? 1)));
    });
  }
  return Promise.resolve(result?.signal ? 1 : (result?.status ?? 1));
}

const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

export function productIntegrationReproduction(directory, tests) {
  const args = [
    'pnpm',
    'exec',
    'vitest',
    'run',
    ...tests,
    '--pool=threads',
    '--maxWorkers=2',
    '--testTimeout=30000',
    '--reporter=dot',
  ];
  return `(cd ${shellQuote(directory)} && ${args.map(shellQuote).join(' ')})`;
}

export async function runProductIntegrationTests(
  plan,
  root,
  run = spawn,
  writeError = (line) => process.stderr.write(`${line}\n`),
) {
  const byDirectory = new Map();
  for (const file of plan.tests) {
    const owner = plan.packages.find(
      (entry) => file === entry.directory || file.startsWith(`${entry.directory}/`),
    );
    if (!owner) throw new Error(`integration test has no workspace owner: ${file}`);
    if (!byDirectory.has(owner.directory)) byDirectory.set(owner.directory, []);
    byDirectory.get(owner.directory).push(path.posix.relative(owner.directory, file));
  }
  const groups = [...byDirectory].sort(([left], [right]) => left.localeCompare(right));
  let next = 0;
  const statuses = new Array(groups.length);
  const worker = async () => {
    while (next < groups.length) {
      const index = next;
      next += 1;
      const [directory, tests] = groups[index];
      process.stdout.write(`[${plan.lane}] ${directory}: ${tests.join(', ')}\n`);
      statuses[index] = await completedStatus(
        run(
          'pnpm',
          [
            'exec',
            'vitest',
            'run',
            ...tests,
            '--pool=threads',
            '--maxWorkers=2',
            '--testTimeout=30000',
            '--reporter=dot',
          ],
          { cwd: path.join(root, directory), stdio: 'inherit' },
        ),
      );
      if (statuses[index] !== 0) {
        writeError(`[${plan.lane}] failed workspace group: ${directory}`);
        writeError(`[${plan.lane}] reproduce: ${productIntegrationReproduction(directory, tests)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, groups.length) }, () => worker()));
  if (statuses.some((status) => status !== 0)) {
    writeError(
      `[${plan.lane}] ${statuses.filter((status) => status !== 0).length} workspace group(s) failed`,
    );
    return 1;
  }
  return 0;
}

export async function main(argv = process.argv.slice(2), environment = process.env) {
  const options = parseArgs(argv);
  const resolution =
    options.changedFiles.length > 0
      ? { ok: true, files: options.changedFiles }
      : resolveChangedFiles({
          root: options.root,
          baseRef: options.baseRef,
          headRef: options.headRef,
          environment,
        });
  const select = options.externalUnits
    ? selectExternalContributionUnitTests
    : selectProductIntegrationTests;
  const plan = select({ root: options.root, changedFiles: resolution.ok ? resolution.files : [] });
  if (!resolution.ok) plan.reason = `change resolution failed closed: ${resolution.reason}`;
  const applicable = plan.tests.length > 0;
  if (options.buildTargets) {
    const directories = new Set(
      plan.packages
        .filter(({ tests }) => tests.some((test) => plan.tests.includes(test)))
        .map(({ directory }) => directory),
    );
    for (const directory of [...directories].sort()) {
      process.stdout.write(`${directory}/__ci_integration_target__.ts\n`);
    }
    return { ...plan, applicable, status: 0 };
  }
  if (options.githubOutput) {
    if (!environment.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
    appendFileSync(environment.GITHUB_OUTPUT, `applicable=${applicable ? 'true' : 'false'}\n`);
    appendFileSync(environment.GITHUB_OUTPUT, `count=${plan.tests.length}\n`);
  }
  process.stdout.write(
    `[${plan.lane}] ${plan.mode}: ${plan.reason}; ${plan.tests.length} test(s) selected\n`,
  );
  if (options.list || options.githubOutput) return { ...plan, applicable, status: 0 };
  if (!applicable) throw new Error(`${plan.lane} runner started with no applicable tests`);
  const status = await runProductIntegrationTests(plan, options.root);
  process.exitCode = status;
  return { ...plan, applicable, status };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`product integration selection failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
