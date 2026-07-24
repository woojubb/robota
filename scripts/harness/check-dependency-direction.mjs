#!/usr/bin/env node

/**
 * Check for bidirectional production dependencies between workspace packages.
 *
 * Rules enforced:
 * 1. No bidirectional production dependencies (A depends on B AND B depends on A).
 * 2. No pass-through re-exports of entire packages (export * from '@robota-sdk/other').
 * 3. agent-core must have zero production dependencies on other @robota-sdk/agent-* packages.
 * 4. agent-plugin-* packages may only depend on agent-core among @robota-sdk/* packages.
 * 8. Entry-point-only aggregators (absorbed from the former check-entry-point-only.mjs,
 *    ARCH-PROVIDER-004 / Stage C): only sanctioned composition roots may STATICALLY import a
 *    guarded composition aggregator (see `checkEntryPointOnly`).
 * 9. Workspace-package-name guard (absorbed from the former check-architecture-conformance.mjs,
 *    INFRA-003/GATE-CONFORMANCE mechanical core): canonical architecture docs must reference
 *    only real workspace packages (see `checkWorkspacePackageNames`).
 *
 * `--conformance-json` additionally emits the machine-readable summary between
 * CONFORMANCE_JSON_BEGIN/END that the GATE-CONFORMANCE consumers parse — `pnpm
 * harness:conformance` is an alias for this mode, preserving the former standalone
 * entrypoint's contract without the subprocess wrapper.
 *
 * Exit code 0 = clean, 1 = violations found.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { loadHarnessConfig } from './harness-config.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const FORBIDDEN_PRODUCTION_DEPENDENCIES = [];
const HARNESS = loadHarnessConfig();

export function findWorkspacePackages() {
  const packages = new Map();

  for (const dir of ['packages', 'apps']) {
    const base = join(ROOT, dir);
    if (!existsSync(base)) continue;

    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgJsonPath = join(base, entry.name, 'package.json');
      if (!existsSync(pkgJsonPath)) {
        // Check for nested workspace packages.
        const nestedDir = join(base, entry.name);
        for (const nested of readdirSync(nestedDir, { withFileTypes: true })) {
          if (!nested.isDirectory()) continue;
          const nestedPkgJson = join(nestedDir, nested.name, 'package.json');
          if (existsSync(nestedPkgJson)) {
            const pkg = JSON.parse(readFileSync(nestedPkgJson, 'utf8'));
            packages.set(pkg.name, {
              name: pkg.name,
              path: join(nestedDir, nested.name),
              dependencies: Object.keys(pkg.dependencies || {}),
              allDependencies: [
                ...new Set([
                  ...Object.keys(pkg.dependencies || {}),
                  ...Object.keys(pkg.devDependencies || {}),
                  ...Object.keys(pkg.peerDependencies || {}),
                ]),
              ],
            });
          }
        }
        continue;
      }
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      packages.set(pkg.name, {
        name: pkg.name,
        path: join(base, entry.name),
        dependencies: Object.keys(pkg.dependencies || {}),
        allDependencies: [
          ...new Set([
            ...Object.keys(pkg.dependencies || {}),
            ...Object.keys(pkg.devDependencies || {}),
            ...Object.keys(pkg.peerDependencies || {}),
          ]),
        ],
      });
    }
  }

  return packages;
}

function checkBidirectionalDeps(packages) {
  const violations = [];
  const workspaceNames = new Set(packages.keys());

  for (const [name, pkg] of packages) {
    for (const dep of pkg.dependencies) {
      if (dep === name) continue; // skip self-ref from duplicate package names in packages/ vs apps/
      if (!workspaceNames.has(dep)) continue;
      const depPkg = packages.get(dep);
      if (depPkg.dependencies.includes(name)) {
        // Only report each pair once (alphabetical order)
        const key = [name, dep].sort().join(' <-> ');
        if (!violations.some((v) => v.key === key)) {
          violations.push({
            key,
            a: name,
            b: dep,
            message: `Bidirectional dependency: ${name} <-> ${dep}`,
          });
        }
      }
    }
  }

  return violations;
}

function checkPassthroughReexports(packages) {
  const violations = [];
  const workspaceNames = new Set(packages.keys());

  for (const [name, pkg] of packages) {
    const indexPath = join(pkg.path, 'src', 'index.ts');
    if (!existsSync(indexPath)) continue;

    const content = readFileSync(indexPath, 'utf8');
    const reexportPattern = /export\s+\*\s+from\s+['"](@robota-sdk\/[^'"]+)['"]/g;

    let match;
    while ((match = reexportPattern.exec(content)) !== null) {
      const reexportedPkg = match[1];
      if (workspaceNames.has(reexportedPkg)) {
        violations.push({
          package: name,
          reexports: reexportedPkg,
          message: `Pass-through re-export: ${name} re-exports all of ${reexportedPkg}`,
        });
      }
    }
  }

  return violations;
}

function checkForbiddenProductionDeps(packages) {
  const violations = [];

  for (const rule of FORBIDDEN_PRODUCTION_DEPENDENCIES) {
    const pkg = packages.get(rule.from);
    if (!pkg) continue;
    if (!pkg.dependencies.includes(rule.to)) continue;
    violations.push({
      from: rule.from,
      to: rule.to,
      reason: rule.reason,
      message: `Forbidden production dependency: ${rule.from} -> ${rule.to}. ${rule.reason}`,
    });
  }

  return violations;
}

/**
 * Rule 3: agent-core must have zero production dependencies on other @robota-sdk/agent-* packages.
 * agent-core is the foundation layer; other agent-* packages register with it, not the reverse.
 */
function checkAgentCoreZeroDeps(packages) {
  const violations = [];
  const core = packages.get(HARNESS.corePackage);
  if (!core) return violations;

  for (const dep of core.dependencies) {
    if (dep.startsWith(HARNESS.internalPackagePrefix) && dep !== HARNESS.corePackage) {
      violations.push({
        package: HARNESS.corePackage,
        dep,
        message:
          `core zero-deps violation: ${HARNESS.corePackage} must not depend on ${dep}. ` +
          'the core package is the foundation layer; other internal packages register through its contracts.',
      });
    }
  }

  return violations;
}

/**
 * Rule 4: agent-plugin-* packages may only depend on agent-core among @robota-sdk/* packages.
 * Plugins are leaf nodes in the plugin layer and must not reach into SDK, sessions, or CLI.
 */
function checkPluginLayerDeps(packages) {
  const violations = [];
  const ALLOWED_INTERNAL_DEPS = new Set(HARNESS.internalDeps.pluginLayerAllowed);
  const pluginPrefix = `${HARNESS.internalPackagePrefix}plugin-`;

  for (const [name, pkg] of packages) {
    if (!name.startsWith(pluginPrefix)) continue;

    for (const dep of pkg.dependencies) {
      if (dep.startsWith(HARNESS.npmScopePrefix) && !ALLOWED_INTERNAL_DEPS.has(dep)) {
        violations.push({
          package: name,
          dep,
          message:
            `Plugin layer violation: ${name} must not depend on ${dep}. ` +
            `plugin packages may only depend on ${[...ALLOWED_INTERNAL_DEPS].join(', ')}.`,
        });
      }
    }
  }

  return violations;
}

/**
 * Rule 5 (INFRA-025): agent-interface-* packages are pure contract SSOTs — their production
 * dependencies must be a subset of {agent-core}. Depending on an implementation package
 * reverses the contract direction (the inversion that let executor/session types leak into
 * agent-interface-transport until 2026-07-04).
 */
export function checkInterfacePackageDeps(packages) {
  const violations = [];
  const interfacePrefix = `${HARNESS.internalPackagePrefix}interface-`;

  for (const [name, pkg] of packages) {
    if (!name.startsWith(interfacePrefix)) continue;
    for (const dep of pkg.dependencies) {
      if (dep.startsWith(HARNESS.npmScopePrefix) && dep !== HARNESS.corePackage) {
        violations.push({
          package: name,
          dep,
          message:
            `Interface-package violation: ${name} must not depend on ${dep}. ` +
            `agent-interface-* packages own contracts; implementations depend on them, ` +
            `never the reverse (deps ⊆ {${HARNESS.corePackage}}).`,
        });
      }
    }
  }

  return violations;
}

/**
 * Frozen baseline (HARNESS-016 / ARL-16b): dag-node leaf-invariant exceptions, keyed by the exact
 * `"<package> -> <dep>"` edge with a reason. The former `dag-node-llm-text-router` aggregator (the only
 * node→node fan-out) is REMOVED by ARCH-PROVIDER-003 — provider DIP collapsed the five vendor nodes + router
 * into the single registry-injected `dag-node-llm-text`, so the leaf invariant now holds with no exceptions.
 * (ARL-11 node-half resolved.) New node→node / node→orchestrator edges are NOT in this set and must fail.
 */
const DAG_NODES_LEAF_ALLOWLIST = new Set([]);

/**
 * Rule 7 (HARNESS-016 / ARL-16b): a `@robota-sdk/dag-node-*` leaf package may depend, among `dag-*`
 * packages, ONLY on the node-contract owners `{dag-core, dag-node}`. Depending on an orchestrator/runtime/
 * adapter layer (`dag-runtime`/`dag-framework`/`dag-worker`/`dag-projection`/`dag-scheduler`/
 * `dag-orchestration-*`/`dag-api`/`dag-builder`/`dag-adapters-*`/…) or on a **sibling** `dag-node-*` breaks
 * the leaf invariant (a leaf must not know the orchestrator or its peers). Scope: intra-DAG leaf-ness only —
 * the cross-subsystem `dag-node-* → agent-*` assembly reach (ARL-11) is a separate invariant not policed here.
 * Scanned scope: every `packages/dag-nodes/*` package (name `@robota-sdk/dag-node-*`); allow-set = the
 * node-contract owners; exceptions frozen in `DAG_NODES_LEAF_ALLOWLIST`.
 */
export function checkDagNodesLeaf(packages) {
  const violations = [];
  const nodePrefix = `${HARNESS.npmScopePrefix}dag-node-`;
  const dagPrefix = `${HARNESS.npmScopePrefix}dag-`;
  const allowedDagTargets = new Set([
    `${HARNESS.npmScopePrefix}dag-core`,
    `${HARNESS.npmScopePrefix}dag-node`,
  ]);

  for (const [name, pkg] of packages) {
    if (!name.startsWith(nodePrefix)) continue;
    for (const dep of pkg.dependencies) {
      if (!dep.startsWith(dagPrefix)) continue; // only intra-DAG edges are policed here
      if (allowedDagTargets.has(dep)) continue;
      if (DAG_NODES_LEAF_ALLOWLIST.has(`${name} -> ${dep}`)) continue;
      violations.push({
        package: name,
        dep,
        message:
          `dag-nodes leaf violation: ${name} must not depend on ${dep}. ` +
          `A dag-node-* leaf may depend only on {dag-core, dag-node} among dag-* packages — never an ` +
          `orchestrator/runtime/adapter layer or a sibling dag-node-*.`,
      });
    }
  }

  return violations;
}

/**
 * Rule 8 (ARCH-PROVIDER-004 / Stage C, absorbed from check-entry-point-only.mjs):
 * `@robota-sdk/dag-nodes-default` is a composition aggregator — it statically pulls the whole
 * default DAG node catalog. Only COMPOSITION ROOTS may import it statically: application entry
 * points (`apps/*`, always sanctioned) and the CLI/command/MCP packages that assemble a runtime.
 * Mid-layer libraries (notably `@robota-sdk/dag-framework`) must NOT take a static edge to it —
 * the framework loads it via a dynamic `import()` (the sanctioned seam, intentionally NOT
 * matched: a dynamic import has no `from`). Test files (`*.test.ts*` / `__tests__/`) are
 * excluded — a test-only static import is a dev concern, not a production layering violation.
 *
 * Guarded aggregators → the set of package names sanctioned to statically import them (beyond any
 * `apps/*`). Keep this list tight: adding a sanctioned importer is a deliberate decision.
 */
const GUARDED_AGGREGATORS = {
  '@robota-sdk/dag-nodes-default': new Set([
    '@robota-sdk/agent-command-workflows',
    '@robota-sdk/dag-cli',
    '@robota-sdk/dag-mcp-server',
  ]),
};

function walkTs(dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      files.push(...walkTs(full));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx')
    ) {
      files.push(full);
    }
  }
  return files;
}

/** Whether `dir` is an application entry point (`apps/<name>`), always a sanctioned composition root. */
function isApp(dir) {
  return basename(dirname(resolve(dir))) === 'apps';
}

/**
 * Pure Rule-8 scan (exported for the fixture self-test): return every violating STATIC edge to a
 * guarded aggregator.
 * @param {{dir: string, name: string|null, files: {path: string, text: string}[]}[]} sourcePackages
 */
export function checkEntryPointOnly(sourcePackages) {
  const violations = [];
  for (const pkg of sourcePackages) {
    for (const [aggregator, sanctioned] of Object.entries(GUARDED_AGGREGATORS)) {
      if (pkg.name === aggregator) continue; // the aggregator itself
      if (isApp(pkg.dir)) continue; // apps are always entry points
      if (pkg.name !== null && sanctioned.has(pkg.name)) continue; // sanctioned root
      // Static edge: `... from '<aggregator>'` (import or export). Dynamic import('<aggregator>') has no `from`.
      // Escape ALL regex metacharacters in the package name (js/incomplete-sanitization: the old
      // scan escaped only '/' and '-', so a name containing '.' etc. would match too loosely).
      const escapedAggregator = aggregator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const edge = new RegExp(`from\\s+['"]${escapedAggregator}['"]`);
      for (const file of pkg.files) {
        if (edge.test(file.text)) {
          violations.push({
            package: pkg.name ?? pkg.dir,
            aggregator,
            file: file.path,
            message:
              `${pkg.name ?? pkg.dir} statically imports ${aggregator} (${file.path}). ` +
              `Load it dynamically or move the composition to an entry point.`,
          });
        }
      }
    }
  }
  return violations;
}

/**
 * Rule 9 (INFRA-003 / GATE-CONFORMANCE mechanical core, absorbed from
 * check-architecture-conformance.mjs): canonical architecture documents (configured in
 * `architectureDocs.files`/`.dirs` + every `packages/<name>/docs/SPEC.md`) must reference only
 * REAL workspace packages. A `<internalPackagePrefix><token>` reference that is not a workspace
 * package name is drift (the AF-02/03/04/05/06/08/12/13 class from the INFRA-002 audit). A line
 * carrying a "planned" marker (case-insensitive) is exempt, so documented-but-uncreated packages
 * are allowed.
 */
const PLANNED_MARKER = /planned/i;

function collectArchitectureDocFiles(root, docConfig) {
  const files = [];
  for (const rel of docConfig.files ?? []) {
    const abs = join(root, rel);
    if (existsSync(abs)) files.push(abs);
  }
  for (const dir of docConfig.dirs ?? []) {
    const abs = join(root, dir);
    if (existsSync(abs)) walkMarkdown(abs, files);
  }
  const pkgBase = join(root, 'packages');
  if (existsSync(pkgBase)) {
    for (const entry of readdirSync(pkgBase, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const spec = join(pkgBase, entry.name, 'docs', 'SPEC.md');
      if (existsSync(spec)) files.push(spec);
    }
  }
  return files.sort();
}

function walkMarkdown(dir, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(full, acc);
    else if (entry.isFile() && entry.name.endsWith('.md')) acc.push(full);
  }
}

export function checkWorkspacePackageNames(
  root,
  workspaceNames,
  docConfig = HARNESS.architectureDocs ?? {},
  internalPackagePrefix = HARNESS.internalPackagePrefix,
) {
  const escapedPrefix = internalPackagePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokenPattern = new RegExp(`${escapedPrefix}[a-z0-9]+(?:-[a-z0-9]+)*`, 'g');
  const violations = [];

  for (const file of collectArchitectureDocFiles(root, docConfig)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      if (PLANNED_MARKER.test(line)) return; // documented-but-uncreated packages are allowed
      const seen = new Set();
      let match;
      tokenPattern.lastIndex = 0;
      while ((match = tokenPattern.exec(line)) !== null) {
        const token = match[0];
        if (seen.has(token)) continue;
        seen.add(token);
        if (!workspaceNames.has(token)) {
          violations.push({
            file: relative(root, file),
            line: idx + 1,
            token,
            message:
              `Unknown package reference: ${relative(root, file)}:${idx + 1} → ${token} ` +
              `(not a real workspace package, and not on a line marked "planned").`,
          });
        }
      }
    });
  }
  return violations.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
  );
}

/** Load `{dir, name, files}` source views of every workspace package for the Rule-8 scan. */
function loadSourcePackages(packages) {
  return [...packages.values()].map((pkg) => ({
    dir: pkg.path,
    name: pkg.name,
    files: walkTs(join(pkg.path, 'src')).map((filePath) => ({
      path: filePath.replace(ROOT + '/', ''),
      text: readFileSync(filePath, 'utf8'),
    })),
  }));
}

function runScan({ conformanceJson = false } = {}) {
  const packages = findWorkspacePackages();
  const biDirViolations = checkBidirectionalDeps(packages);
  const reexportViolations = checkPassthroughReexports(packages);
  const forbiddenDepViolations = checkForbiddenProductionDeps(packages);
  const coreZeroDepViolations = checkAgentCoreZeroDeps(packages);
  const pluginLayerViolations = checkPluginLayerDeps(packages);
  const interfacePackageViolations = checkInterfacePackageDeps(packages);
  const dagNodesLeafViolations = checkDagNodesLeaf(packages);
  const fullGraphCycleViolations = checkFullGraphCycles(packages);
  const entryPointOnlyViolations = checkEntryPointOnly(loadSourcePackages(packages));
  const packageNameViolations = checkWorkspacePackageNames(ROOT, new Set(packages.keys()));

  const dependencyViolationCount =
    biDirViolations.length +
    reexportViolations.length +
    forbiddenDepViolations.length +
    coreZeroDepViolations.length +
    pluginLayerViolations.length +
    interfacePackageViolations.length +
    dagNodesLeafViolations.length +
    fullGraphCycleViolations.length +
    entryPointOnlyViolations.length;

  const hasViolations = dependencyViolationCount > 0 || packageNameViolations.length > 0;

  if (hasViolations) {
    console.error('❌ Dependency direction violations found:\n');
    for (const v of biDirViolations) {
      console.error(`  [CYCLE] ${v.message}`);
    }
    for (const v of reexportViolations) {
      console.error(`  [RE-EXPORT] ${v.message}`);
    }
    for (const v of forbiddenDepViolations) {
      console.error(`  [FORBIDDEN-DEP] ${v.message}`);
    }
    for (const v of coreZeroDepViolations) {
      console.error(`  [CORE-ZERO-DEPS] ${v.message}`);
    }
    for (const v of pluginLayerViolations) {
      console.error(`  [PLUGIN-LAYER] ${v.message}`);
    }
    for (const v of interfacePackageViolations) {
      console.error(`  [INTERFACE-DEPS] ${v.message}`);
    }
    for (const v of dagNodesLeafViolations) {
      console.error(`  [DAG-NODES-LEAF] ${v.message}`);
    }
    for (const v of fullGraphCycleViolations) {
      console.error(`  [DEV-CYCLE] ${v.message}`);
    }
    for (const v of entryPointOnlyViolations) {
      console.error(`  [ENTRY-POINT-ONLY] ${v.message}`);
    }
    for (const v of packageNameViolations) {
      console.error(`  [PACKAGE-NAME] ${v.message}`);
    }
    console.error('');
  } else {
    console.log('✅ No dependency direction violations found.');
  }

  if (conformanceJson) {
    // GATE-CONFORMANCE machine-readable summary (contract kept from the absorbed
    // check-architecture-conformance.mjs — consumed by the conformance skills/gates).
    const summary = {
      dependencyDirection: dependencyViolationCount === 0 ? 'pass' : 'fail',
      packageNameViolations: packageNameViolations.length,
      unknownPackageTokens: [...new Set(packageNameViolations.map((v) => v.token))].sort(),
      conformant: !hasViolations,
    };
    console.log('CONFORMANCE_JSON_BEGIN');
    console.log(JSON.stringify(summary, null, 2));
    console.log('CONFORMANCE_JSON_END');
  }

  process.exit(hasViolations ? 1 : 0);
}

/**
 * Rule 6 (HARNESS-022 / STRUCT-03): the FULL dependency graph (prod+dev+peer) must stay
 * acyclic. Direction rules stay prod-scoped, but a dev-edge cycle (e.g. transport ->
 * command devDep meeting a future command -> transport edge) would deadlock installs and
 * break topological builds while every prod-only check stays green.
 */
export function checkFullGraphCycles(packages) {
  const violations = [];
  const names = new Set(packages.keys());
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map([...names].map((name) => [name, WHITE]));

  function dfs(name, stack) {
    color.set(name, GRAY);
    stack.push(name);
    for (const dep of packages.get(name).allDependencies ?? []) {
      if (dep === name || !names.has(dep)) continue;
      if (color.get(dep) === GRAY) {
        const cycleStart = stack.indexOf(dep);
        violations.push({
          message: `Full-graph cycle (prod+dev+peer): ${[...stack.slice(cycleStart), dep].join(' -> ')}`,
        });
        continue;
      }
      if (color.get(dep) === WHITE) dfs(dep, stack);
    }
    stack.pop();
    color.set(name, BLACK);
  }

  for (const name of names) {
    if (color.get(name) === WHITE) dfs(name, []);
  }
  return violations;
}

const isDirectExecution =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isDirectExecution) {
  runScan({ conformanceJson: process.argv.includes('--conformance-json') });
}
