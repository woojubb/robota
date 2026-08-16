#!/usr/bin/env node

/**
 * ARCH-021: the child-process subagent runner must not compose the product's surface.
 *
 * ## The class
 *
 * A neutral package that imports a product's defaults and builds a surface from them is a
 * composition-root inversion: the library decides what the product is. `agent-subagent-runner` did
 * exactly that — `createDefaultProviderDefinitions()` for the child's provider registry and
 * `createDefaultTools()` for its tool surface — while the composition root had already handed the
 * runner the fully composed surface and the runner dropped it.
 *
 * ## Why a scan and not just the manifest
 *
 * Deleting the provider-defaults dependency from the manifest makes the PROVIDER axis a compile
 * error: that package solely owns `createDefaultProviderDefinitions`. The TOOL axis cannot be cut the
 * same way — `createDefaultTools` is barrel-exported by `agent-framework`, which this package must
 * keep for `createSubagentSession` / `createSubagentLogger` / `getBuiltInAgent`. So on that axis the
 * import stays compile-legal and this scan is the floor instead.
 *
 * That asymmetry is the reason the scan exists rather than a nicety: the tool axis is the one with
 * the failure history. ARCH-010 (a subagent `Read` returning `/etc/hostname` because the child's
 * tools were unconfined) and ARCH-006 (dropping a pack did not drop its tools from the child) are
 * both tool-surface findings at this seam. The underlying cause — no defaults-aggregator leaf for the
 * tool surface, so no manifest edge can remove it — is tracked as ARCH-035 (#1787).
 *
 * ## What it checks
 *
 * 1. `packages/agent-subagent-runner/src/` imports neither `createDefaultTools` nor
 *    `createDefaultProviderDefinitions`.
 * 2. `packages/agent-subagent-runner/package.json` does not depend on the provider-defaults package
 *    (built from the configured npm scope, not a hardcoded one).
 *
 * Both are the same rule seen from two sides, and both are named so a failure says which one broke.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadHarnessConfig } from './harness-config.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import * as ts from './lib/ts-ast.mjs';

const PACKAGE_DIR = 'packages/agent-subagent-runner';
const SRC_DIR = join(PACKAGE_DIR, 'src');
const FORBIDDEN_IMPORTS = ['createDefaultTools', 'createDefaultProviderDefinitions'];
// Built from the configured scope, not hardcoded: a hardcoded scope does not FAIL when the scope
// changes — it matches nothing, and that reads as a pass.
const HARNESS = loadHarnessConfig();
const FORBIDDEN_DEPENDENCY = `${HARNESS.npmScopePrefix}agent-provider-defaults`;

function collectSourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...collectSourceFiles(path));
      continue;
    }
    if (path.endsWith('.ts') || path.endsWith('.mts')) files.push(path);
  }
  return files;
}

/**
 * Which forbidden symbols a file actually imports.
 *
 * Read from the AST, not a regex. My first version was
 * `\bimport\b[\s\S]*?\bSYMBOL\b[\s\S]*?from\s+['"]` — which spans the WHOLE file, so it
 * missed `import * as fw from '…'; fw.createDefaultTools()` and `const { createDefaultTools } =
 * await import('…')`, and false-flagged this very file once a later line contained `from '` (its
 * own docblock names both symbols while explaining why it must not import them). A floor for the
 * axis with the failure history cannot be approximate in both directions.
 *
 * The sibling this scan sits beside, `scan-interface-runtime.mjs`, already reads imports from the
 * AST; this uses the same helper.
 */
function forbiddenImports(content, fileName) {
  const sourceFile = ts.createSourceFile(fileName, content);
  const found = new Set();

  const noteBinding = (name) => {
    if (FORBIDDEN_IMPORTS.includes(name)) found.add(name);
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      // `import createDefaultTools from …` — the default binding.
      if (clause?.name) noteBinding(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings?.elements) {
        // `import { createDefaultTools as x } from …` — the IMPORTED name is what identifies it.
        for (const element of bindings.elements) {
          noteBinding((element.propertyName ?? element.name).text);
        }
      }
      // `import * as fw from …` — the symbol is reached through the namespace, so any later
      // `fw.createDefaultTools(...)` counts. Checked below over the whole file's identifiers.
      if (bindings?.name) namespaceAliases.add(bindings.name.text);
    } else if (ts.isImportEqualsDeclaration?.(node)) {
      if (node.name) noteBinding(node.name.text);
    } else if (node.kind === ts.SyntaxKind?.CallExpression) {
      // `await import('…')` destructured — the binding names appear as identifiers; the property
      // access sweep below catches the usage either way.
      void 0;
    }
    ts.forEachChild(node, visit);
  };

  const namespaceAliases = new Set();
  visit(sourceFile);

  // A namespaced or dynamically-imported symbol is used via a property access. Only look for that
  // when a namespace alias exists or a dynamic import is present — otherwise a comment could match.
  if (namespaceAliases.size > 0 || /\bimport\s*\(/.test(content)) {
    for (const symbol of FORBIDDEN_IMPORTS) {
      const usage = new RegExp(`\\.\\s*${symbol}\\s*\\(`);
      if (usage.test(content)) found.add(symbol);
      const destructured = new RegExp(
        `\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*=\\s*await\\s+import\\s*\\(`,
      );
      if (destructured.test(content)) found.add(symbol);
    }
  }

  return [...found];
}

export function findSubagentRunnerCompositionFindings(root = process.cwd()) {
  // Fail CLOSED over a root without the governed tree. Without this the scan would report "no
  // findings" for a tree it never read — which reads exactly like a clean package, and this is a
  // floor for the axis with the failure history.
  requireGovernedTree(root, [SRC_DIR], {
    scan: 'subagent-runner-composition',
    why: 'It asserts a specific package composes nothing; over a root without that package, "the runner imports no defaults" is vacuously true.',
  });
  const findings = [];

  const srcDir = join(root, SRC_DIR);
  const files = collectSourceFiles(srcDir);
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const symbol of forbiddenImports(content, file)) {
      findings.push({
        file: file.slice(root.length + 1),
        detail:
          `imports \`${symbol}\` — a neutral runner must not compose the product's surface. ` +
          'The composition root supplies `ISubagentWorkerComposition` (ARCH-021).',
      });
    }
  }

  const manifest = JSON.parse(readFileSync(join(root, PACKAGE_DIR, 'package.json'), 'utf8'));
  const dependencies = { ...manifest.dependencies };
  if (FORBIDDEN_DEPENDENCY in dependencies) {
    findings.push({
      file: `${PACKAGE_DIR}/package.json`,
      detail:
        `depends on \`${FORBIDDEN_DEPENDENCY}\` — ARCH-021 removed this edge so reaching for the ` +
        'default provider registry does not compile.',
    });
  }

  return { findings, examined: { files: files.length, manifests: 1 } };
}

// The repo's idiom. A basename heuristic misses e.g. a backslash argv path, and then this script
// exits 0 having examined nothing — a silent pass for the only floor on the tool axis.
const isMain = resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const { findings, examined } = findSubagentRunnerCompositionFindings();
  if (findings.length > 0) {
    console.error('subagent-runner-composition scan FAILED:');
    for (const finding of findings) console.error(`  - ${finding.file}: ${finding.detail}`);
    process.exit(1);
  }
  console.log(
    `subagent-runner-composition scan passed (examined ${examined.files} source file(s) ` +
      `and ${examined.manifests} manifest).`,
  );
}
