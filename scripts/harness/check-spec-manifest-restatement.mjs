#!/usr/bin/env node

/**
 * DOCS-028 (issue #2194) — a package SPEC does not restate a fact its manifest owns.
 *
 * ## The defect this closes, measured
 *
 * 7 of 58 package SPECs stated a layer in prose, and the sentence carried the package's dependency
 * set with it: "Layer 1 (depends on `agent-core` only among framework packages …)". Five of the seven
 * were the IDENTICAL sentence, copy-pasted. **Two were false.** `agent-builtin-providers` claimed
 * `agent-core` only while depending on four provider siblings — untrue since ARCH-PROVIDER-002 created
 * it as the aggregator — and `agent-provider-openai` claimed the same while depending on
 * `agent-provider-openai-compatible`.
 *
 * Nothing compared any of them to `package.json`, which is where the answer actually lives.
 *
 * ## Why a check rather than a sweep, and why THIS check rather than a comparison
 *
 * The obvious fix is to parse the prose claim and diff it against the manifest. That keeps two copies
 * of one fact and puts a parser between them, which is the arrangement that produced the drift.
 * `learning-loop.md` § Contradiction Between Rules settles it: *"Prefer deleting the restatement to
 * keeping both and checking them."* So the restatements were removed, and this refuses a new one.
 *
 * ARCH-101 established the same shape one family over: one declaration, one reader, no second copy.
 *
 * ## WHAT IT CHECKS — deliberately narrow
 *
 * The `- **Layer**:` field in a SPEC's `## Package Identity` section must not name a workspace
 * package. The layer NAME is a classification the manifest does not carry and belongs in the SPEC;
 * the dependency set that places the package at that layer is `package.json`'s, and is enforced by
 * `check-dependency-direction.mjs`.
 *
 * ## WHAT IT DOES NOT CHECK, stated so the green is not read as wider than it is
 *
 * Only that one structured field. A SPEC's prose elsewhere may still restate a dependency set, and
 * this check cannot see it. That is deliberate rather than an oversight: a SPEC legitimately states
 * BOUNDARIES ("must never depend on the framework"), which are constraints the manifest does not own,
 * and no pattern separates a boundary claim from a dependency restatement without reading intent.
 * Widening it would produce a check that fails on correct documents, which gets suppressed rather
 * than obeyed.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';
import { loadHarnessConfig } from './harness-config.mjs';
import { listWorkspacePackageDirs } from './workspace-packages.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const HARNESS = loadHarnessConfig();

/** The structured Layer field, if the SPEC has one. */
const LAYER_FIELD = /^- \*\*Layer\*\*: (.+)$/m;

/**
 * A finding per SPEC whose Layer field names a workspace package.
 *
 * Exported for the fixture: the decision is a pure function of (text, package names), so it is
 * tested directly rather than through `main()` — a guard reachable only through `main()` is a guard
 * no test can falsify (ARCH-101, issue #2181).
 */
export function findLayerRestatements(specs, workspacePackageNames) {
  const findings = [];
  for (const { file, text } of specs) {
    const match = LAYER_FIELD.exec(text);
    if (!match) continue;
    const claim = match[1];
    // A whole token, not a substring: `tool` must not match inside `tool-defaults`, and `\b` does
    // not help because a hyphen is itself a word boundary.
    const named = workspacePackageNames.filter((name) =>
      new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(claim),
    );
    if (named.length > 0) {
      findings.push({
        file,
        named,
        detail:
          `the Layer field names ${named.map((n) => `\`${n}\``).join(', ')}. ` +
          `A package's dependency set is declared in its package.json and enforced by ` +
          `check-dependency-direction.mjs — restating it here creates a second copy that drifts ` +
          `(measured: 2 of 7 such claims were already false). State the layer NAME and point at the ` +
          `owner; do not enumerate dependencies.`,
      });
    }
  }
  return findings;
}

/**
 * The corpus, and the names a Layer field may not enumerate.
 *
 * Exported so the size this scan declares is the output of the traversal that did the work, and is
 * tested as that output rather than asserted in prose (measurement-provenance.md).
 */
let examinedCount = 0;

export function collectSpecs(root) {
  requireGovernedTree(root, ['packages'], {
    scan: 'spec-manifest-restatement',
    why: 'the package SPEC corpus IS the population — over a root without it there is no SPEC to judge, and "no findings" would claim no SPEC restates its manifest when none was read.',
  });
  // Absolute paths, per `listWorkspacePackageDirs`'s contract. Reported relative to the root so a
  // finding is a path a reader can paste.
  const dirs = listWorkspacePackageDirs(root);
  const names = [];
  const specs = [];
  for (const dir of dirs) {
    const base = path.basename(dir);
    names.push(`${HARNESS.npmScopePrefix}${base}`, base);
    const specPath = path.join(dir, 'docs', 'SPEC.md');
    try {
      specs.push({ file: path.relative(root, specPath), text: readFileSync(specPath, 'utf8') });
    } catch {
      // allow-fallback: a package without a SPEC is another scan's finding, not this one's
    }
  }
  // Longest first, so `agent-provider-openai-compatible` is reported rather than its prefix.
  names.sort((a, b) => b.length - a.length);
  // Assigned, never incremented: a counter that accumulates across runs reports a size that grew
  // without the corpus growing (measurement-provenance.md).
  examinedCount = specs.length;
  return { specs, names };
}

/**
 * The number this scan declares it examined, readable by a test rather than only printable.
 *
 * measurement-provenance.md requires the reader convention (`examined…Count`) so the declaration is
 * an OUTPUT a fixture can assert on, not a string in a log nobody can reach.
 */
export function examinedSpecCount() {
  return examinedCount;
}

export async function main() {
  const { specs, names } = collectSpecs(WORKSPACE_ROOT);

  const findings = findLayerRestatements(specs, names);
  process.stdout.write(`::examined:: ${specs.length} package SPEC(s)\n`);
  if (findings.length === 0) {
    process.stdout.write(
      'spec-manifest-restatement scan passed. It bounds the Layer field only — prose elsewhere in a ' +
        'SPEC may still restate a dependency set, and this check cannot see it.\n',
    );
    return;
  }
  process.stdout.write('spec-manifest-restatement scan failed:\n');
  for (const f of findings) process.stdout.write(`- ${f.file}: ${f.detail}\n`);
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  await main();
}
