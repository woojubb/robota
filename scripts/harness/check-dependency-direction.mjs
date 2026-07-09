#!/usr/bin/env node

/**
 * Check for bidirectional production dependencies between workspace packages.
 *
 * Rules enforced:
 * 1. No bidirectional production dependencies (A depends on B AND B depends on A).
 * 2. No pass-through re-exports of entire packages (export * from '@robota-sdk/other').
 * 3. agent-core must have zero production dependencies on other @robota-sdk/agent-* packages.
 * 4. agent-plugin-* packages may only depend on agent-core among @robota-sdk/* packages.
 *
 * Exit code 0 = clean, 1 = violations found.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

function runScan() {
  const packages = findWorkspacePackages();
  const biDirViolations = checkBidirectionalDeps(packages);
  const reexportViolations = checkPassthroughReexports(packages);
  const forbiddenDepViolations = checkForbiddenProductionDeps(packages);
  const coreZeroDepViolations = checkAgentCoreZeroDeps(packages);
  const pluginLayerViolations = checkPluginLayerDeps(packages);
  const interfacePackageViolations = checkInterfacePackageDeps(packages);
  const dagNodesLeafViolations = checkDagNodesLeaf(packages);
  const fullGraphCycleViolations = checkFullGraphCycles(packages);

  const hasViolations =
    biDirViolations.length > 0 ||
    reexportViolations.length > 0 ||
    forbiddenDepViolations.length > 0 ||
    coreZeroDepViolations.length > 0 ||
    pluginLayerViolations.length > 0 ||
    interfacePackageViolations.length > 0 ||
    dagNodesLeafViolations.length > 0 ||
    fullGraphCycleViolations.length > 0;

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
    console.error('');
    process.exit(1);
  } else {
    console.log('✅ No dependency direction violations found.');
    process.exit(0);
  }
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
  runScan();
}
