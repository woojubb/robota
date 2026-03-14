#!/usr/bin/env node

/**
 * Check for bidirectional production dependencies between workspace packages.
 *
 * Rules enforced:
 * 1. No bidirectional production dependencies (A depends on B AND B depends on A).
 * 2. No pass-through re-exports of entire packages (export * from '@robota-sdk/other').
 *
 * Exit code 0 = clean, 1 = violations found.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

function findWorkspacePackages() {
    const packages = new Map();

    for (const dir of ['packages', 'apps']) {
        const base = join(ROOT, dir);
        if (!existsSync(base)) continue;

        for (const entry of readdirSync(base, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const pkgJsonPath = join(base, entry.name, 'package.json');
            if (!existsSync(pkgJsonPath)) {
                // Check for nested packages (e.g., dag-nodes/*)
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
            if (!workspaceNames.has(dep)) continue;
            const depPkg = packages.get(dep);
            if (depPkg.dependencies.includes(name)) {
                // Only report each pair once (alphabetical order)
                const key = [name, dep].sort().join(' <-> ');
                if (!violations.some(v => v.key === key)) {
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

const packages = findWorkspacePackages();
const biDirViolations = checkBidirectionalDeps(packages);
const reexportViolations = checkPassthroughReexports(packages);

const hasViolations = biDirViolations.length > 0 || reexportViolations.length > 0;

if (hasViolations) {
    console.error('❌ Dependency direction violations found:\n');
    for (const v of biDirViolations) {
        console.error(`  [CYCLE] ${v.message}`);
    }
    for (const v of reexportViolations) {
        console.error(`  [RE-EXPORT] ${v.message}`);
    }
    console.error('');
    process.exit(1);
} else {
    console.log('✅ No dependency direction violations found.');
    process.exit(0);
}
