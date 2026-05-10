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

const ROOT = resolve(import.meta.dirname, '../..');
const FORBIDDEN_PRODUCTION_DEPENDENCIES = [];

function findWorkspacePackages() {
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
  const core = packages.get('@robota-sdk/agent-core');
  if (!core) return violations;

  for (const dep of core.dependencies) {
    if (dep.startsWith('@robota-sdk/agent-') && dep !== '@robota-sdk/agent-core') {
      violations.push({
        package: '@robota-sdk/agent-core',
        dep,
        message:
          `agent-core zero-deps violation: @robota-sdk/agent-core must not depend on ${dep}. ` +
          'agent-core is the foundation layer; other agent-* packages register through its contracts.',
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
  const ALLOWED_ROBOTA_DEPS = new Set(['@robota-sdk/agent-core']);

  for (const [name, pkg] of packages) {
    if (!name.startsWith('@robota-sdk/agent-plugin-')) continue;

    for (const dep of pkg.dependencies) {
      if (dep.startsWith('@robota-sdk/') && !ALLOWED_ROBOTA_DEPS.has(dep)) {
        violations.push({
          package: name,
          dep,
          message:
            `Plugin layer violation: ${name} must not depend on ${dep}. ` +
            'agent-plugin-* packages may only depend on @robota-sdk/agent-core.',
        });
      }
    }
  }

  return violations;
}

const packages = findWorkspacePackages();
const biDirViolations = checkBidirectionalDeps(packages);
const reexportViolations = checkPassthroughReexports(packages);
const forbiddenDepViolations = checkForbiddenProductionDeps(packages);
const coreZeroDepViolations = checkAgentCoreZeroDeps(packages);
const pluginLayerViolations = checkPluginLayerDeps(packages);

const hasViolations =
  biDirViolations.length > 0 ||
  reexportViolations.length > 0 ||
  forbiddenDepViolations.length > 0 ||
  coreZeroDepViolations.length > 0 ||
  pluginLayerViolations.length > 0;

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
  console.error('');
  process.exit(1);
} else {
  console.log('✅ No dependency direction violations found.');
  process.exit(0);
}
