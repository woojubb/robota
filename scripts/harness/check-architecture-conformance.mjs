#!/usr/bin/env node

/**
 * Architecture conformance gate — the mechanical core of GATE-CONFORMANCE (INFRA-003).
 *
 * Composes, does not duplicate:
 *   1. Dependency-direction check — delegates to `check-dependency-direction.mjs`.
 *   2. Workspace-package-name guard — fails if any canonical architecture document references a
 *      `@robota-sdk/agent-*` token that is not a real workspace package (the highest-leverage guard
 *      from the INFRA-002 audit: prevents AF-02/03/04/05/06/08/12/13 from recurring). A line carrying
 *      a "planned" marker (case-insensitive) is exempt, so documented-but-uncreated packages are allowed.
 *
 * This is a STANDALONE entrypoint (`pnpm harness:conformance`), deliberately NOT wired into
 * `run-all-scans.mjs`: the INFRA-002 audit found pre-existing prose drift that INFRA-004~007 will clear,
 * so making it block every PR now would be a false gate. Promote it into the aggregate scan once the
 * P0/P1 doc-correction backlogs land.
 *
 * Output: a human summary plus a machine-readable JSON block (between CONFORMANCE_JSON_BEGIN/END).
 * Exit code 0 = conformant, 1 = violations found.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '../..');

/** Canonical architecture documents whose prose/diagrams must reference only real packages. */
const DOC_GLOBS = [
  'ARCHITECTURE.md',
  '.agents/project-structure.md',
  '.agents/specs/ARCHITECTURE-MAP.md',
];
const DOC_DIRS = ['.agents/specs/architecture-map'];
const PACKAGE_SPEC_GLOB = 'packages'; // packages/<name>/docs/SPEC.md

const ROBOTA_TOKEN = /@robota-sdk\/agent-[a-z0-9]+(?:-[a-z0-9]+)*/g;
const PLANNED_MARKER = /planned/i;

function findWorkspacePackageNames() {
  const names = new Set();
  for (const dir of ['packages', 'apps']) {
    const base = join(ROOT, dir);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgJsonPath = join(base, entry.name, 'package.json');
      if (existsSync(pkgJsonPath)) {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
        if (pkg.name) names.add(pkg.name);
      }
    }
  }
  return names;
}

function collectMarkdownFiles() {
  const files = [];
  for (const rel of DOC_GLOBS) {
    const abs = join(ROOT, rel);
    if (existsSync(abs)) files.push(abs);
  }
  for (const dir of DOC_DIRS) {
    const abs = join(ROOT, dir);
    if (existsSync(abs)) walkMarkdown(abs, files);
  }
  const pkgBase = join(ROOT, PACKAGE_SPEC_GLOB);
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

function scanPackageNameViolations(workspaceNames) {
  const violations = [];
  for (const file of collectMarkdownFiles()) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      if (PLANNED_MARKER.test(line)) return; // documented-but-uncreated packages are allowed
      const seen = new Set();
      let match;
      ROBOTA_TOKEN.lastIndex = 0;
      while ((match = ROBOTA_TOKEN.exec(line)) !== null) {
        const token = match[0];
        if (seen.has(token)) continue;
        seen.add(token);
        if (!workspaceNames.has(token)) {
          violations.push({
            file: relative(ROOT, file),
            line: idx + 1,
            token,
          });
        }
      }
    });
  }
  return violations.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
  );
}

function runDependencyDirectionCheck() {
  const result = spawnSync('node', ['scripts/harness/check-dependency-direction.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
  };
}

const workspaceNames = findWorkspacePackageNames();
const depCheck = runDependencyDirectionCheck();
const nameViolations = scanPackageNameViolations(workspaceNames);

const summary = {
  dependencyDirection: depCheck.ok ? 'pass' : 'fail',
  packageNameViolations: nameViolations.length,
  unknownPackageTokens: [...new Set(nameViolations.map((v) => v.token))].sort(),
  conformant: depCheck.ok && nameViolations.length === 0,
};

console.log('Architecture conformance gate (GATE-CONFORMANCE mechanical core)\n');
console.log(`  dependency-direction : ${depCheck.ok ? '✅ pass' : '❌ fail'}`);
console.log(
  `  workspace-package-name : ${nameViolations.length === 0 ? '✅ pass' : `❌ ${nameViolations.length} violation(s)`}`,
);
if (!depCheck.ok) {
  console.log('\n  dependency-direction output:');
  for (const ln of depCheck.output.split('\n')) console.log(`    ${ln}`);
}
if (nameViolations.length > 0) {
  console.log('\n  Unknown @robota-sdk/agent-* package references (not a real workspace package,');
  console.log('  and not on a line marked "planned"):');
  for (const v of nameViolations) {
    console.log(`    ${v.file}:${v.line} → ${v.token}`);
  }
}

console.log('\nCONFORMANCE_JSON_BEGIN');
console.log(JSON.stringify(summary, null, 2));
console.log('CONFORMANCE_JSON_END');

if (summary.conformant) {
  console.log('\n✅ Architecture conformance: PASS');
  process.exit(0);
} else {
  console.log('\n❌ Architecture conformance: FAIL');
  process.exit(1);
}
