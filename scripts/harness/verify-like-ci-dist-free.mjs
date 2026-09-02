import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runWithDistFreeSubject } from './dist-free-subject-identity.mjs';
import {
  findMissingDist as findMissingDistIn,
  listBuildablePackageDirs as listBuildablePackageDirsIn,
} from './tree-prerequisites.mjs';
import { WORKSPACE_ROOT, gitOrThrow, parseGitFileList, run } from './verify-like-ci-shared.mjs';

const CI_WORKFLOW = path.join('.github', 'workflows', 'ci.yml');
const DIRECT_SCAN = /^\s*(?:run:\s*)?pnpm\s+(harness:scan\s+--\s+[^\r\n]*)\s*$/gm;
const SCAN_ARRAY = /^\s*([A-Za-z_][A-Za-z0-9_]*)=\((harness:scan\s+--\s+[^\r\n]*)\)\s*$/gm;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertOnlyBenchmarkAppends(source, name) {
  const append = new RegExp(`^\\s*${escapeRegExp(name)}\\+=\\([^\\r\\n]*\\)\\s*$`);
  const ifStack = [];
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (/^if\b.*;\s*then$/.test(trimmed)) {
      ifStack.push(/^if \[\[ "\$BENCHMARK_MODE" == "true" \]\]; then$/.test(trimmed));
      continue;
    }
    if (trimmed === 'fi') {
      ifStack.pop();
      continue;
    }
    if (append.test(line) && !ifStack.includes(true)) {
      throw new Error(
        `\`${name}\` is appended outside the BENCHMARK_MODE-only branch; the PR scan set is ambiguous.`,
      );
    }
  }
}

function dynamicScanCommands(source) {
  const assignments = [...source.matchAll(SCAN_ARRAY)];
  // Let the caller report the stronger top-level invariant first: multiple scan definitions are
  // already an ambiguous mirror target, regardless of how those arrays happen to be invoked.
  if (assignments.length > 1) return assignments.map((match) => match[2]);

  return assignments.map((match) => {
    const [, name, command] = match;
    const invocation = new RegExp(
      `^\\s*start_check\\s+\\S+\\s+pnpm\\s+"\\$\\{${escapeRegExp(name)}\\[@\\]\\}"\\s*$`,
      'gm',
    );
    const invocations = [...source.matchAll(invocation)];
    if (invocations.length !== 1) {
      throw new Error(
        `expected exactly one \`start_check … pnpm "\${${name}[@]}"\` invocation, found ${invocations.length}.`,
      );
    }
    assertOnlyBenchmarkAppends(source, name);
    return command;
  });
}

export function listBuildablePackageDirs(root = WORKSPACE_ROOT) {
  return listBuildablePackageDirsIn(root);
}

export function findMissingDist(dirs, exists = existsSync, root = WORKSPACE_ROOT) {
  return findMissingDistIn(dirs, exists, root);
}

export function parseDistIndependentScanSkips(ciYaml) {
  const source = String(ciYaml ?? '');
  const commands = [
    ...[...source.matchAll(DIRECT_SCAN)].map((match) => match[1]),
    ...dynamicScanCommands(source),
  ];
  if (commands.length === 0) {
    throw new Error(
      `no \`harness:scan -- --skip …\` command found in ${CI_WORKFLOW} — the dist-free stage cannot mirror a job it cannot read.`,
    );
  }
  if (commands.length > 1) {
    throw new Error(
      `more than one \`harness:scan -- --skip …\` command in ${CI_WORKFLOW} — ambiguous mirror target; the dist-free stage must name exactly one.`,
    );
  }
  const skips = [...commands[0].matchAll(/--skip\s+([A-Za-z0-9_-]+)/g)].map((skip) => skip[1]);
  if (skips.length === 0) {
    throw new Error(`the mirrored \`harness:scan\` command in ${CI_WORKFLOW} has no skip set.`);
  }
  return skips;
}

export function readDistIndependentScanSkips(root = WORKSPACE_ROOT) {
  const workflowPath = path.join(root, CI_WORKFLOW);
  if (!existsSync(workflowPath)) {
    throw new Error(`${CI_WORKFLOW} not found — cannot derive the dist-independent scan set.`);
  }
  return parseDistIndependentScanSkips(readFileSync(workflowPath, 'utf8'));
}

export function listNodeModulesOwners(root = WORKSPACE_ROOT, maxDepth = 5) {
  const owners = [];
  const skip = new Set(['node_modules', 'dist', '.git']);
  const walk = (dir, depth) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    if (entries.some((entry) => entry.name === 'node_modules'))
      owners.push(path.relative(root, dir));
    if (depth >= maxDepth) return;
    for (const entry of entries) {
      if (!entry.isDirectory() || skip.has(entry.name)) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };
  walk(root, 0);
  return owners.sort();
}

export async function runScanSuite() {
  const code = await run('pnpm', ['harness:scan:build-contracts']);
  return { code, note: 'dist-dependent build-output contracts, matching quality' };
}

function createDistFreeTree(treeDir, patchFile) {
  gitOrThrow(['worktree', 'add', '--detach', treeDir, 'HEAD']);
  const patch = gitOrThrow(['diff', 'HEAD', '--binary']);
  if (patch.trim().length > 0) {
    writeFileSync(patchFile, patch);
    gitOrThrow(['apply', '--whitespace=nowarn', patchFile], treeDir);
  }
  const untracked = parseGitFileList(gitOrThrow(['ls-files', '--others', '--exclude-standard']));
  for (const file of untracked) {
    const source = path.join(WORKSPACE_ROOT, file);
    if (!existsSync(source)) continue;
    const target = path.join(treeDir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  const links = [];
  for (const owner of listNodeModulesOwners()) {
    const link = path.join(treeDir, owner, 'node_modules');
    if (!existsSync(path.dirname(link))) continue;
    symlinkSync(path.join(WORKSPACE_ROOT, owner, 'node_modules'), link, 'junction');
    links.push(link);
  }
  return links;
}

function destroyDistFreeTree(treeDir, links, tempRoot) {
  for (const link of links) {
    try {
      rmSync(link, { force: true });
    } catch (error) {
      process.stderr.write(
        `[scan-suite-dist-free] could not unlink ${link}: ${error?.message ?? error}\n` +
          `[scan-suite-dist-free] leaving ${tempRoot} in place — removing a tree that still borrows\n` +
          `[scan-suite-dist-free] the real node_modules is not worth the risk. Delete it by hand.\n`,
      );
      return;
    }
  }
  const removal = spawnSync('git', ['worktree', 'remove', '--force', treeDir], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
  });
  if (removal.status !== 0) {
    process.stderr.write(
      `[scan-suite-dist-free] leftover worktree at ${treeDir}: ${removal.stderr?.trim()}\n` +
        `[scan-suite-dist-free] clean up with: git worktree remove --force ${treeDir}\n`,
    );
  }
  rmSync(tempRoot, { recursive: true, force: true });
}

export async function runDistFreeScanSuite({ baseRef }) {
  const skips = readDistIndependentScanSkips();
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'verify-like-ci-dist-free-'));
  const treeDir = path.join(tempRoot, 'tree');
  let links = [];
  try {
    links = createDistFreeTree(treeDir, path.join(tempRoot, 'working-tree.patch'));
    const args = [
      'scripts/harness/run-all-scans.mjs',
      '--affected',
      '--base',
      baseRef,
      '--context',
      'pr',
      ...skips.flatMap((skip) => ['--skip', skip]),
    ];
    const code = await runWithDistFreeSubject(run, args, treeDir, process.env, gitOrThrow);
    if (code !== 0) {
      process.stderr.write(
        `\n[scan-suite-dist-free] These scans ran on a build-output-FREE copy of this branch — the\n` +
          `[scan-suite-dist-free] tree CI's \`scans\` job checks out. A finding here that passes the\n` +
          `[scan-suite-dist-free] built-tree stage means the code depends on dist/ existing (e.g. a\n` +
          `[scan-suite-dist-free] hardcoded build-output path literal), and CI will fail on it.\n`,
      );
    }
    return { code, note: `affected dist-free worktree vs ${baseRef}, skips: ${skips.join(', ')}` };
  } catch (error) {
    process.stderr.write(`\n[scan-suite-dist-free] ${error?.message ?? error}\n`);
    return { code: 1, note: 'could not materialise the dist-free tree' };
  } finally {
    destroyDistFreeTree(treeDir, links, tempRoot);
  }
}
