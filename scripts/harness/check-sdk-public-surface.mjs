#!/usr/bin/env node

/**
 * Check SDK public export layering so lower-package owners do not become hidden
 * top-level SDK contracts by accident.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { requireGovernedTree } from './governed-tree.mjs';

const WORKSPACE_ROOT = process.cwd();
const SDK_PACKAGE_JSON = 'packages/agent-framework/package.json';
const SDK_PACKAGE_DIR = path.posix.dirname(SDK_PACKAGE_JSON);
const SDK_SRC_DIR = 'packages/agent-framework/src';
/**
 * Files permitted to re-export `agent-executor` symbols, with the REAL reason each is here.
 *
 * RENAMED from `SDK_RUNTIME_FACADE_FILES` by ARCH-037. The old name and the failure message below
 * both still announced the retired "runtime facade" criterion, so the mechanism a developer meets
 * would have kept teaching the rule this docblock had already disproved — and the next audit would
 * have re-raised the same finding verbatim. A criterion that lives only in a comment is the
 * narrower-than-the-rule shape this item exists to remove.
 *
 * ARCH-037 asked for one of two things: apply this set's stated criterion to its surviving entry and
 * empty the set, or replace the comment with the real distinguishing reason. Emptying it was tried
 * first and REFUTED by the compiler, so this is the second branch — and the refutation is the useful
 * part, because the old comment was wrong in a way that reading could not reveal.
 *
 * The old justification was "runtime facade": a file re-exporting executor RUNTIME VALUES. Counted,
 * the surviving entry has none — its `agent-executor` re-exports are a single `export type { … }`
 * block of ten type-only names. By that criterion it did not belong, exactly as ARCH-031 argued when
 * it deleted the sibling entry.
 *
 * But deleting the block turned `pnpm typecheck` RED, and that is the real reason. Measured, not
 * counted by eye: `IBackgroundTaskRunner` is imported from this barrel by SIX files across FOUR
 * packages — `agent-cli`, `agent-product`, `agent-transport` and `agent-transport-tui`. Of those,
 * `agent-product`'s permitted dependency set is "agent-framework + agent-preset +
 * agent-capability-pack + type-only agent-interface-transport + agent-core types"
 * (`.agents/project-structure.md`), and neither `agent-transport-tui` nor `agent-transport` declares
 * `agent-executor` either, so for all three this barrel is the ONLY permitted path to the type.
 * (`agent-cli` does depend on `agent-executor` and imports the runner from it directly elsewhere, so
 * for that consumer alone the entry blesses a path it does not need.)
 *
 * An earlier revision of this paragraph said "RED in two packages" and named only the first two —
 * a line-based search cannot see a name inside a multi-line import block, and the undercount sat
 * eight lines above a corrected count saying four, i.e. the file contradicted itself.
 *
 * The entry is load-bearing; it was simply never load-bearing for the reason written beside it.
 *
 * So the criterion is now DEPENDENCY REACH, not runtime-ness: an entry belongs here when a permitted
 * consumer cannot reach the symbol any other way, and the entry must name that consumer. An entry
 * that cannot name one is the next reader's false permission — ARCH-031's sentence, which holds
 * whichever criterion is in force.
 */
const SDK_UNREACHABLE_ELSEWHERE_FILES = new Set([
  // `IBackgroundTaskRunner` is reached through this barrel by `agent-product`, `agent-transport-tui`,
  // `agent-transport` and `agent-cli` — none of the first three may depend on `agent-executor`.
  // Verified by deletion: removing the block reddens their typecheck.
  // Contained — ARCH-039. The criterion is
  // per-symbol but this entry is per-file, and measurement puts external importers on exactly ONE
  // of the block's ten names, so the other nine ride along. Narrowing it belongs with ARCH-039.
  'packages/agent-framework/src/background-tasks/index.ts',
]);
const FORBIDDEN_TOP_LEVEL_OWNER_PACKAGES = [
  '@robota-sdk/agent-core',
  '@robota-sdk/agent-session',
  '@robota-sdk/agent-tools',
];
const EXECUTOR_PACKAGE = '@robota-sdk/agent-executor';

function isForbiddenTopLevelOwnerPackage(source) {
  return FORBIDDEN_TOP_LEVEL_OWNER_PACKAGES.some(
    (ownerPackage) => source === ownerPackage || source.startsWith(`${ownerPackage}/`),
  );
}

function extractReExportDeclarations(content) {
  return [
    ...content.matchAll(
      /\bexport\s+(?:type\s+)?(?:\*|\*\s+as\s+\w+|\{[\s\S]*?\})\s+from\s+['"]([^'"]+)['"]/g,
    ),
  ].map((match) => ({
    statement: match[0],
    source: match[1],
  }));
}

function extractNamedBindings(list, useLocalAlias) {
  return list
    .split(',')
    .map((entry) => entry.trim().replace(/^type\s+/, ''))
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [original, alias] = entry.split(/\s+as\s+/);
      return useLocalAlias ? (alias ?? original) : original;
    });
}

function extractImportDeclarations(content) {
  return [...content.matchAll(/\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)].map(
    (match) => {
      const clause = match[1].trim();
      const bindings = [];
      const named = clause.match(/\{([\s\S]*?)\}/);
      if (named) bindings.push(...extractNamedBindings(named[1], true));
      const namespace = clause.match(/\*\s+as\s+(\w+)/);
      if (namespace) bindings.push(namespace[1]);
      const defaultBinding = clause.split(',')[0]?.trim();
      if (defaultBinding && !defaultBinding.startsWith('{') && !defaultBinding.startsWith('*')) {
        bindings.push(defaultBinding);
      }
      return { source: match[2], bindings };
    },
  );
}

function extractLocalExportBindings(content) {
  const bindings = [];
  for (const match of content.matchAll(/\bexport\s+(?:type\s+)?\{([\s\S]*?)\}(?!\s*from)/g)) {
    bindings.push(...extractNamedBindings(match[1], false));
  }
  return new Set(bindings);
}

function extractPassThroughSources(content) {
  const sources = extractReExportDeclarations(content).map((declaration) => declaration.source);
  const exportedBindings = extractLocalExportBindings(content);
  for (const declaration of extractImportDeclarations(content)) {
    if (declaration.bindings.some((binding) => exportedBindings.has(binding))) {
      sources.push(declaration.source);
    }
  }
  return sources;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function toWorkspaceRelative(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

function collectSourceTargets(value, targets) {
  if (typeof value === 'string') {
    targets.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectSourceTargets(entry, targets);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const nested of Object.values(value)) collectSourceTargets(nested, targets);
}

async function readPublicSourceRoots(root) {
  const packageJsonPath = path.join(root, SDK_PACKAGE_JSON);
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  const exportEntries = packageJson.exports;
  if (exportEntries === null || typeof exportEntries !== 'object') {
    throw new Error('sdk-public-surface: agent-framework package.json has no exports map.');
  }

  const targets = [];
  for (const exportEntry of Object.values(exportEntries)) {
    if (exportEntry !== null && typeof exportEntry === 'object' && 'source' in exportEntry) {
      collectSourceTargets(exportEntry.source, targets);
    }
  }
  if (targets.length === 0) {
    throw new Error(
      'sdk-public-surface: agent-framework package exports declare no source entry roots.',
    );
  }

  return [...new Set(targets)].map((target) =>
    toWorkspaceRelative(root, path.resolve(root, SDK_PACKAGE_DIR, target)),
  );
}

async function resolveLocalReExport(root, file, source) {
  const absoluteBase = path.resolve(root, path.dirname(file), source);
  const sourceRoot = path.resolve(root, SDK_SRC_DIR);
  if (absoluteBase !== sourceRoot && !absoluteBase.startsWith(`${sourceRoot}${path.sep}`)) {
    return undefined;
  }

  const extension = path.extname(absoluteBase);
  const candidates = [];
  if (extension === '.js') {
    candidates.push(`${absoluteBase.slice(0, -'.js'.length)}.ts`);
  } else if (extension === '.ts') {
    candidates.push(absoluteBase);
  } else if (extension.length === 0) {
    candidates.push(`${absoluteBase}.ts`, path.join(absoluteBase, 'index.ts'));
  }

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return toWorkspaceRelative(root, candidate);
  }
  return undefined;
}

function findExportStarFindings(file, content) {
  return extractReExportDeclarations(content)
    .filter((declaration) => /^\s*export\s+(?:type\s+)?\*/.test(declaration.statement))
    .map(() => ({
      file,
      type: 'sdk-public-export-star',
      detail:
        'agent-framework public barrels must use explicit named exports so owner boundaries are auditable.',
    }));
}

function findOwnerPassThroughFindings(file, content) {
  return extractPassThroughSources(content)
    .filter((source) => isForbiddenTopLevelOwnerPackage(source))
    .map((source) => ({
      file,
      type: 'sdk-public-owner-pass-through',
      detail: `Public agent-framework export graph must not pass through ${source}; import from the owning package or add an explicit SDK-owned facade.`,
    }));
}

async function collectReachableFindings(root, file, visited, findings) {
  if (visited.has(file)) return;
  visited.add(file);

  const absoluteFile = path.join(root, file);
  if (!(await pathExists(absoluteFile))) {
    findings.push({
      file,
      type: 'sdk-public-unresolved-export-root',
      detail: 'Package-declared public source root does not resolve to a TypeScript source file.',
    });
    return;
  }

  const content = await fs.readFile(absoluteFile, 'utf8');
  findings.push(...findExportStarFindings(file, content));
  findings.push(...findOwnerPassThroughFindings(file, content));
  findings.push(...findUnexpectedExecutorReexportFindings(file, content));

  const reachableSources = new Set([
    ...extractReExportDeclarations(content).map((declaration) => declaration.source),
    ...extractPassThroughSources(content),
  ]);
  for (const source of reachableSources) {
    if (!source.startsWith('.')) continue;
    const target = await resolveLocalReExport(root, file, source);
    if (target === undefined) {
      findings.push({
        file,
        type: 'sdk-public-unresolved-local-re-export',
        detail: `Public local re-export ${source} does not resolve to a TypeScript source file.`,
      });
      continue;
    }
    await collectReachableFindings(root, target, visited, findings);
  }
}

function findUnexpectedExecutorReexportFindings(file, content) {
  if (SDK_UNREACHABLE_ELSEWHERE_FILES.has(file)) return [];
  return extractPassThroughSources(content)
    .filter((source) => source === EXECUTOR_PACKAGE || source.startsWith(`${EXECUTOR_PACKAGE}/`))
    .map(() => ({
      file,
      type: 'sdk-unreachable-elsewhere-location',
      detail:
        'agent-executor public re-exports belong only where a permitted consumer cannot reach the symbol any other way (see SDK_UNREACHABLE_ELSEWHERE_FILES), not in arbitrary SDK files.',
    }));
}

export async function findSdkPublicSurfaceFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, [SDK_PACKAGE_JSON, SDK_SRC_DIR], {
    scan: 'sdk-public-surface',
    why: 'The SDK source tree is the surface under audit; walking zero files reports a clean surface it never saw.',
  });
  const findings = [];
  const visited = new Set();
  for (const file of await readPublicSourceRoots(root)) {
    await collectReachableFindings(root, file, visited, findings);
  }
  return findings;
}

async function main() {
  const findings = await findSdkPublicSurfaceFindings();
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`[${finding.type}] ${finding.file}: ${finding.detail}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('sdk public surface scan passed.');
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  void main();
}
