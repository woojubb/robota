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
const SDK_UNREACHABLE_ELSEWHERE_SYMBOLS = {
  // ARCH-039 narrowed this from a per-FILE grant to a per-SYMBOL one. The criterion was always per
  // symbol — a re-export is permitted where a package allowed to consume THAT symbol has no other
  // legal import path to it — while the grant covered whole files, so nine names rode along on the
  // one that earned it. Measured across the workspace: of the ten names this file re-exported,
  // exactly `IBackgroundTaskRunner` had an external importer (6 files across agent-cli,
  // agent-product, agent-transport and agent-transport-tui), and of those only agent-cli can reach
  // `agent-executor` directly.
  //
  // Listing the symbol rather than the file is what stops a new name joining silently: adding one to
  // the block is now a finding until it is added here too, with a consumer that needs it.
  'packages/agent-framework/src/background-tasks/index.ts': new Set(['IBackgroundTaskRunner']),
};
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

async function readPublicSourceRoots(root, packageJsonRelative) {
  const packageDir = path.posix.dirname(packageJsonRelative);
  const packageJson = JSON.parse(await fs.readFile(path.join(root, packageJsonRelative), 'utf8'));
  const exportEntries = packageJson.exports;
  if (exportEntries === null || typeof exportEntries !== 'object') {
    // ARCH-039: not every publishable package declares an exports map. Reporting that as a THROW
    // when the scan covered one package was right — the one package definitely had one. Across 31 it
    // would turn a package's shape into an infrastructure failure, so a package with no exports map
    // simply contributes no roots and the caller reports the count it examined.
    return [];
  }

  const targets = [];
  for (const exportEntry of Object.values(exportEntries)) {
    if (exportEntry !== null && typeof exportEntry === 'object' && 'source' in exportEntry) {
      collectSourceTargets(exportEntry.source, targets);
    }
  }
  return [...new Set(targets)].map((target) =>
    toWorkspaceRelative(root, path.resolve(root, packageDir, target)),
  );
}

/**
 * Every publishable package, as `package.json` paths relative to the root.
 *
 * ARCH-039: the scan governed `agent-framework` alone, so a pass-through placed in any other package
 * was invisible. `private: true` packages are excluded — they never reach npm, so there is no
 * published surface to protect.
 */
async function readPublishablePackageJsonPaths(root) {
  const packagesDir = path.join(root, 'packages');
  const entries = await fs.readdir(packagesDir, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const relative = `packages/${entry.name}/package.json`;
    if (!(await pathExists(path.join(root, relative)))) continue;
    const manifest = JSON.parse(await fs.readFile(path.join(root, relative), 'utf8'));
    if (manifest.private === true) continue;
    found.push(relative);
  }
  return found.sort();
}

/** The `packages/<name>/src` a workspace-relative file sits under. */
function packageSrcDirOf(file) {
  const marker = '/src/';
  const index = file.indexOf(marker);
  return index === -1 ? path.posix.dirname(file) : file.slice(0, index + marker.length - 1);
}

async function resolveLocalReExport(root, file, source) {
  const absoluteBase = path.resolve(root, path.dirname(file), source);
  // ARCH-039: the containment root is the package the FILE belongs to, not a hard-coded
  // `agent-framework/src`. While the scan governed one package those were the same string; once it
  // governs 31 they are not, and the hard-coded form rejected every other package's own files as
  // "unresolved" — 233 findings that were a resolver defect, not debt.
  const packageSourceRoot = path.resolve(root, packageSrcDirOf(file));
  if (
    absoluteBase !== packageSourceRoot &&
    !absoluteBase.startsWith(`${packageSourceRoot}${path.sep}`)
  ) {
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
  const permitted = SDK_UNREACHABLE_ELSEWHERE_SYMBOLS[file];
  const findings = [];
  for (const { source, symbols } of extractExecutorReexportedSymbols(content)) {
    if (source !== EXECUTOR_PACKAGE && !source.startsWith(`${EXECUTOR_PACKAGE}/`)) continue;
    if (permitted === undefined) {
      findings.push({
        file,
        type: 'sdk-unreachable-elsewhere-location',
        detail:
          'agent-executor public re-exports belong only where a permitted consumer cannot reach the symbol any other way (see SDK_UNREACHABLE_ELSEWHERE_SYMBOLS), not in arbitrary SDK files.',
      });
      continue;
    }
    // A file on the list still only earns the NAMES on it. An `export *` cannot be checked per
    // symbol at all, so it is refused outright rather than trusted — that is the shape a per-symbol
    // grant exists to prevent.
    if (symbols === undefined) {
      findings.push({
        file,
        type: 'sdk-unreachable-elsewhere-symbol',
        detail: `\`export *\` from ${source} cannot be checked per symbol, so it cannot be permitted here. List the names this file actually needs.`,
      });
      continue;
    }
    for (const symbol of symbols) {
      if (permitted.has(symbol)) continue;
      findings.push({
        file,
        type: 'sdk-unreachable-elsewhere-symbol',
        detail: `\`${symbol}\` is re-exported from ${source} but is not one of the names this file is permitted to carry (${[...permitted].join(', ')}). A permitted name is one a legal consumer cannot reach any other way; add it to SDK_UNREACHABLE_ELSEWHERE_SYMBOLS with that consumer named, or import it from its owner.`,
      });
    }
  }
  return findings;
}

/**
 * Every re-export of `agent-executor`, with the symbol NAMES it publishes.
 *
 * `symbols: undefined` means `export *` — a form whose names cannot be read from this file, which is
 * why the rule refuses it inside a permitted file rather than assuming it carries only earned names.
 */
function extractExecutorReexportedSymbols(content) {
  const results = [];
  for (const declaration of extractReExportDeclarations(content)) {
    const clause = declaration.statement.match(/\{([\s\S]*?)\}/);
    results.push({
      source: declaration.source,
      symbols: clause ? extractNamedBindings(clause[1], true) : undefined,
    });
  }
  const exportedBindings = extractLocalExportBindings(content);
  for (const declaration of extractImportDeclarations(content)) {
    const carried = declaration.bindings.filter((binding) => exportedBindings.has(binding));
    if (carried.length > 0) results.push({ source: declaration.source, symbols: carried });
  }
  return results;
}

/** What the last run examined. Exported so a test asserts the number the scan prints. */
let examinedPackages = 0;

export function examinedPackageCount() {
  return examinedPackages;
}

/**
 * Per-package frozen counts — the burn-down ARCH-039's measurement showed is required.
 *
 * Widening this scan from one package to every publishable one surfaces 105 pre-existing findings,
 * 98 of them `export *` barrels. Failing the whole tree on day one gets a floor switched off, so
 * what exists is frozen per package and may only SHRINK. A package absent from this map must be
 * clean: that is what stops the debt spreading to packages that do not have it today.
 *
 * `agent-framework` is deliberately absent and therefore held at zero — it is the package the scan
 * governed before the widening, and it has no findings to freeze.
 */
const FROZEN_FINDING_COUNTS = {
  'agent-command': 27,
  'agent-core': 20,
  'agent-executor': 2,
  'agent-interface-transport': 1,
  'agent-plugin': 8,
  'agent-provider-anthropic': 4,
  'agent-provider-bytedance': 3,
  'agent-provider-gemini': 8,
  'agent-provider-openai': 4,
  'agent-provider-openai-compatible': 21,
  'agent-session': 1,
  'agent-transport': 4,
  'agent-transport-tui': 1,
};

export async function findSdkPublicSurfaceFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, [SDK_PACKAGE_JSON, SDK_SRC_DIR], {
    scan: 'sdk-public-surface',
    why: 'The SDK source tree is the surface under audit; walking zero files reports a clean surface it never saw.',
  });
  const findings = [];
  const visited = new Set();
  const packageJsonPaths = await readPublishablePackageJsonPaths(root);
  examinedPackages = 0;
  for (const packageJsonRelative of packageJsonPaths) {
    const roots = await readPublicSourceRoots(root, packageJsonRelative);
    if (roots.length === 0) continue;
    examinedPackages += 1;
    for (const file of roots) {
      await collectReachableFindings(root, file, visited, findings);
    }
  }
  return findings;
}

/** Which package a workspace-relative file belongs to. */
function packageNameOf(file) {
  return file.split('/')[1] ?? '';
}

/**
 * Findings above what their package has frozen, plus a report of any package that IMPROVED.
 *
 * A count that fell without the baseline being re-frozen is reported too, and deliberately as a
 * failure: an unlocked gain is a licence to grow back to the old number.
 */
export function applyFrozenCounts(findings) {
  const counted = new Map();
  for (const finding of findings) {
    const name = packageNameOf(finding.file);
    counted.set(name, (counted.get(name) ?? 0) + 1);
  }
  const over = [];
  const under = [];
  for (const [name, frozen] of Object.entries(FROZEN_FINDING_COUNTS)) {
    const actual = counted.get(name) ?? 0;
    if (actual > frozen) over.push({ name, actual, frozen });
    if (actual < frozen) under.push({ name, actual, frozen });
  }
  for (const [name, actual] of counted) {
    if (!(name in FROZEN_FINDING_COUNTS)) over.push({ name, actual, frozen: 0 });
  }
  return { over, under };
}

async function main() {
  const findings = await findSdkPublicSurfaceFindings();
  const { over, under } = applyFrozenCounts(findings);
  if (over.length > 0 || under.length > 0) {
    for (const { name, actual, frozen } of over) {
      console.error(
        `[sdk-public-surface-grew] ${name}: ${actual} finding(s), above its frozen ${frozen}. ` +
          `Pre-existing debt may shrink but never grow.`,
      );
      for (const finding of findings.filter((f) => packageNameOf(f.file) === name)) {
        console.error(`  [${finding.type}] ${finding.file}: ${finding.detail}`);
      }
    }
    for (const { name, actual, frozen } of under) {
      console.error(
        `[sdk-public-surface-shrank] ${name}: ${actual} finding(s), below its frozen ${frozen}. ` +
          `Re-freeze in the SAME change so the ratchet keeps the gain.`,
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(`::examined:: ${examinedPackageCount()} publishable packages`);
  console.log(`sdk public surface scan passed (${examinedPackageCount()} package(s) examined).`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  void main();
}
