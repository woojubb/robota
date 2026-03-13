import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PACKAGES_DIR = resolve(import.meta.dirname, '..', '..', '..');

/**
 * Layer dependency rules: each key lists forbidden imports for that package.
 * Violating any of these means a layer boundary was crossed.
 *
 * Layer structure (strict unidirectional):
 *   Layer 1 (Domain):       dag-core           → no internal deps
 *   Layer 2 (Services):     dag-runtime, dag-worker, dag-projection, dag-scheduler, dag-orchestrator → dag-core only
 *   Layer 3 (Composition):  dag-api             → Layer 2 + dag-core
 *   Layer 4 (Infra):        dag-server-core     → dag-api + dag-core
 *   Layer 5 (UI/Apps):      dag-designer        → dag-server-core + dag-api + dag-core (no runtime/worker/scheduler)
 */
const LAYER_RULES: Record<string, string[]> = {
    'dag-core': [
        '@robota-sdk/dag-runtime',
        '@robota-sdk/dag-worker',
        '@robota-sdk/dag-projection',
        '@robota-sdk/dag-scheduler',
        '@robota-sdk/dag-api',
        '@robota-sdk/dag-server-core',
        '@robota-sdk/dag-designer',
        '@robota-sdk/dag-orchestrator',
    ],
    'dag-runtime': [
        '@robota-sdk/dag-api',
        '@robota-sdk/dag-server-core',
        '@robota-sdk/dag-worker',
        '@robota-sdk/dag-designer',
        '@robota-sdk/dag-orchestrator',
    ],
    'dag-worker': [
        '@robota-sdk/dag-api',
        '@robota-sdk/dag-server-core',
        '@robota-sdk/dag-runtime',
        '@robota-sdk/dag-designer',
        '@robota-sdk/dag-orchestrator',
    ],
    'dag-projection': [
        '@robota-sdk/dag-api',
        '@robota-sdk/dag-server-core',
        '@robota-sdk/dag-runtime',
        '@robota-sdk/dag-worker',
        '@robota-sdk/dag-designer',
        '@robota-sdk/dag-orchestrator',
    ],
    'dag-scheduler': [
        '@robota-sdk/dag-api',
        '@robota-sdk/dag-server-core',
        '@robota-sdk/dag-worker',
        '@robota-sdk/dag-designer',
        '@robota-sdk/dag-orchestrator',
    ],
    'dag-orchestrator': [
        '@robota-sdk/dag-api',
        '@robota-sdk/dag-server-core',
        '@robota-sdk/dag-runtime',
        '@robota-sdk/dag-worker',
        '@robota-sdk/dag-designer',
    ],
    'dag-designer': [
        '@robota-sdk/dag-runtime',
        '@robota-sdk/dag-worker',
        '@robota-sdk/dag-projection',
        '@robota-sdk/dag-scheduler',
        '@robota-sdk/dag-orchestrator',
    ],
};

/**
 * Recursively collect all .ts/.tsx files in a directory, excluding node_modules and dist.
 */
function collectSourceFiles(dir: string): string[] {
    const results: string[] = [];
    const entries = readdirSync(dir);

    for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
            if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') {
                continue;
            }
            results.push(...collectSourceFiles(fullPath));
        } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
            results.push(fullPath);
        }
    }

    return results;
}

/**
 * Extracts all import specifiers from a TypeScript file.
 */
function extractImports(content: string): string[] {
    const importRegex = /(?:import|from)\s+['"]([^'"]+)['"]/g;
    const imports: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(content)) !== null) {
        imports.push(match[1]);
    }
    return imports;
}

describe('layer dependency guard', () => {
    for (const [pkgName, forbiddenImports] of Object.entries(LAYER_RULES)) {
        describe(`${pkgName} must not import from forbidden layers`, () => {
            const pkgDir = join(PACKAGES_DIR, pkgName);
            let sourceFiles: string[];

            try {
                sourceFiles = collectSourceFiles(join(pkgDir, 'src'));
            } catch {
                sourceFiles = [];
            }

            if (sourceFiles.length === 0) {
                it.skip(`no source files found for ${pkgName}`, () => {});
            } else {

            it(`should have no forbidden cross-layer imports (${sourceFiles.length} files checked)`, () => {
                const violations: string[] = [];

                for (const file of sourceFiles) {
                    const content = readFileSync(file, 'utf-8');
                    const imports = extractImports(content);
                    const relativePath = file.replace(pkgDir, '');

                    for (const importSpecifier of imports) {
                        for (const forbidden of forbiddenImports) {
                            if (importSpecifier === forbidden || importSpecifier.startsWith(`${forbidden}/`)) {
                                violations.push(`${relativePath}: imports "${importSpecifier}" (forbidden)`);
                            }
                        }
                    }
                }

                expect(violations).toEqual([]);
            });

            } // end else (sourceFiles.length > 0)
        });
    }
});
