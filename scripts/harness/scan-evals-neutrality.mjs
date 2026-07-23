#!/usr/bin/env node

/**
 * HARNESS-034 — mechanical neutrality floor for the SELFHOST-011 evals-as-code subsystem.
 *
 * Library-neutrality invariant (SELFHOST-011): `packages/**` ships only the NEUTRAL mechanism — the
 * definition/runner contract (`IEvalDefinition`/`runEval`), the metric-as-function TYPE (`IMetric`), the
 * dataset PARSER, and parameterized metric FACTORIES (`exactMatch(expected)`, `regexMatch(pattern)`, …).
 * Concrete metrics and datasets are CONSUMER-supplied — the reference lives in
 * `examples/capabilities/agent-eval/`, never in `packages/`. Until now this (TC-05) was enforced only by a
 * manual grep; this scan is the always-on guardian, mirroring `scan-memory-neutrality.mjs` (its closest
 * analog) + the `scan-no-fallback.mjs` suppression/anti-rot convention.
 *
 * It reports two classes of eval CONTENT smuggled into the library (`packages/<pkg>`):
 *
 *  1. `evals-dataset-content` — a dataset/case-corpus DATA file: a `.json`/`.jsonl`/`.csv`/`.yaml`/`.yml`
 *     file whose path is eval-corpus-shaped — either it sits under an `/evals/` DIRECTORY segment, or its
 *     basename carries a corpus marker (`*.evalset.*`, `*.cases.*`, `*.dataset.*`, `*.corpus.*`). Exact path/name check;
 *     zero false positives on the neutral TS surface (which ships no data files).
 *
 *  2. `library-eval-content` — a concrete metric/dataset VALUE shipped as library code: within a `.ts`/`.tsx`
 *     file under an `/evals/` directory segment (the subsystem convention — deliberately NOT "any file", to
 *     bound false positives), an `export` of one of:
 *       - a `cases`/`dataset`/`evalset`-named binding assigned an ARRAY literal (a checked-in case corpus), or
 *       - a value annotated `: IEvalDefinition =` (a concrete eval definition), or
 *       - a value annotated `: IMetric =` (a concrete named metric — as opposed to the neutral FACTORY, which
 *         is declared `export function name(...): IMetric {`, not `export const name: IMetric =`).
 *     This is an evadable FLOOR (a non-matching identifier/type slips through) that BACKS the manual TC-05
 *     review; it does not replace it. Suppress a sanctioned occurrence with an adjacent
 *     `// allow-evals-content: <reason>`.
 *
 *  Anti-rot (v1 = reason-less-only, mypy `ignore-without-code` analogue, mirroring HARNESS-028/029): a
 *  reason-less `allow-evals-content` in a comment fails. Stale-detection is DEFERRED (narrow flagged set).
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { loadHarnessConfig } from './harness-config.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

// Robota-specific POLICY DATA lives in `.agents/harness.config.json` (`neutrality.*`, HARNESS-DIET-002):
// the library root under scan, the evals-subsystem dir convention, the dataset data-file extensions and
// corpus basename markers, and the Class-2 binding terms + concrete contract TYPE names
// (`IEvalDefinition`/`IMetric`). The bespoke engine logic (export-shape regex construction, factory-vs-value
// distinction, suppression/anti-rot mechanics) stays here.
const NEUTRALITY = loadHarnessConfig().neutrality;
const LIBRARY_PACKAGES_DIR = NEUTRALITY.libraryPackagesDir;
const EVALS_SUBSYSTEM_DIRNAME = NEUTRALITY.evalsSubsystemDirName;

/** Data-file extensions a case corpus / evalset would ship as (config data, compiled here). */
const DATASET_DATA_EXT = new RegExp(
  `\\.(${NEUTRALITY.evalsDatasetDataExtensions.join('|')})$`,
  'i',
);

/** Basename markers that name a file as an eval corpus regardless of directory (config data). */
const DATASET_NAME_MARKER = new RegExp(
  `\\.(${NEUTRALITY.evalsDatasetNameMarkers.join('|')})\\.[a-z0-9]+$`,
  'i',
);

/**
 * Class 2 export shapes (concrete metric/dataset VALUE, not the neutral type/factory mechanism):
 *   export const|let|var|default <cases|dataset|evalset...> = [    → checked-in case corpus
 *   export ... <name>: IEvalDefinition =                            → concrete eval definition value
 *   export ... <name>: IMetric =                                    → concrete named metric value
 * A neutral factory (`export function exactMatch(...): IMetric {`) has no `: IMetric =` and is not matched.
 * Binding terms + contract type names are config data; the export-shape machinery is engine.
 */
const LIBRARY_EVAL_CONTENT_DECL = new RegExp(
  `export\\s+(?:const|let|var|default)\\s+\\w*(?:${NEUTRALITY.evalsContentBindingTerms.join('|')})\\w*\\s*(?::[^=]+)?=\\s*\\[` +
    `|export\\s+(?:const|let|var|default)?\\s*\\w+\\s*:\\s*(?:${NEUTRALITY.evalsContentTypeNames.join('|')})\\s*=`,
  'i',
);

/** A well-formed escape hatch: the token followed by `:` and at least one non-space reason char. */
const ANNOTATION_WITH_REASON = /allow-evals-content:\s*\S/;

/** Whether `allow-evals-content` on this line sits in a COMMENT (line/JSDoc/block), not a string. */
function annotationInComment(line) {
  const trimmed = line.trim();
  return (
    /\/\/[^\n]*allow-evals-content/.test(line) ||
    /\/\*[^\n]*allow-evals-content/.test(line) ||
    (/^\*/.test(trimmed) && /allow-evals-content/.test(trimmed))
  );
}

/** Is this path inside the evals-subsystem DIRECTORY segment (the subsystem convention)? */
export function inEvalsSubsystem(rel) {
  return rel.replace(/\\/g, '/').includes(`/${EVALS_SUBSYSTEM_DIRNAME}/`);
}

/**
 * Class 1 (pure predicate, exposed for tests): a dataset/case-corpus DATA file checked into the library —
 * a data-extension file that is eval-corpus-shaped (under an `/evals/` dir, or a corpus-marked basename).
 * Separator-normalized so it is portable (POSIX + Windows) and unit-testable with `/`-separated paths.
 */
export function isEvalsDatasetContent(rel) {
  const norm = rel.replace(/\\/g, '/');
  if (!DATASET_DATA_EXT.test(norm)) return false;
  const base = norm.split('/').pop() ?? '';
  return norm.includes('/evals/') || DATASET_NAME_MARKER.test(base);
}

/**
 * Class 2 (pure content check): a `library-eval-content` finding per source line exporting a concrete
 * metric/dataset VALUE, unless suppressed by an adjacent `allow-evals-content: <reason>`. Exposed so the
 * harness test can assert directly without disk.
 */
export function findEvalsContentInSource(source, file = 'fixture.ts') {
  const findings = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (LIBRARY_EVAL_CONTENT_DECL.test(line)) {
      const windowText = `${lines[i - 1] ?? ''}\n${line}`;
      if (!ANNOTATION_WITH_REASON.test(windowText)) {
        findings.push({
          file,
          line: i + 1,
          kind: 'library-eval-content',
          text: line.trim().slice(0, 120),
        });
      }
    }
    // Anti-rot (v1 = reason-less-only): a comment-scoped `allow-evals-content` MUST carry a `: <reason>`.
    if (annotationInComment(line) && !ANNOTATION_WITH_REASON.test(line)) {
      findings.push({
        file,
        line: i + 1,
        kind: 'reasonless-annotation',
        text: line.trim().slice(0, 120),
      });
    }
  }
  return findings;
}

export function findEvalsNeutralityFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  const packagesDir = path.join(root, LIBRARY_PACKAGES_DIR);
  if (!existsSync(packagesDir)) return findings;
  for (const pkg of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const pkgRel = path.join(LIBRARY_PACKAGES_DIR, pkg.name);
    if (!statSync(path.join(root, pkgRel)).isDirectory()) continue;
    for (const rel of walkPackageFiles(pkgRel, root)) {
      // Class 1 — a dataset/corpus DATA file anywhere in the package.
      if (isEvalsDatasetContent(rel)) {
        findings.push({
          file: rel,
          line: 1,
          kind: 'evals-dataset-content',
          text: path.basename(rel),
        });
        continue;
      }
      // Class 2 — a concrete metric/definition value, only within the evals subsystem source.
      if (/\.tsx?$/.test(rel) && inEvalsSubsystem(rel)) {
        findings.push(...findEvalsContentInSource(readFileSync(path.join(root, rel), 'utf8'), rel));
      }
    }
  }
  return findings;
}

/** Collect ALL non-test files (any extension) under a package, relative to `root`. */
function walkPackageFiles(target, root = WORKSPACE_ROOT) {
  const full = path.join(root, target);
  if (!existsSync(full)) return [];
  const out = [];
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    if (
      entry.name === '__tests__' ||
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === 'coverage' ||
      entry.name === '.turbo'
    ) {
      continue;
    }
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) out.push(...walkPackageFiles(child, root));
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

function main() {
  const findings = findEvalsNeutralityFindings();
  if (findings.length === 0) {
    console.log('evals-neutrality scan passed.');
    process.exit(0);
  }
  console.error(
    'evals-neutrality scan FAILED — eval dataset/metric content in the library (packages/):',
  );
  for (const f of findings) {
    console.error(`  [${f.kind}] ${f.file}:${f.line}  ${f.text}`);
  }
  console.error(
    '\nSELFHOST-011 neutrality: eval datasets + concrete metrics are CONSUMER-supplied (see\n' +
      '  `examples/capabilities/agent-eval/`) — `packages/**` ships only the neutral definition/runner\n' +
      '  contract, the IMetric TYPE, the dataset parser, and parameterized metric FACTORIES.\n' +
      '  - evals-dataset-content: move the corpus/evalset file to the consumer workspace / examples.\n' +
      '  - library-eval-content: move the concrete metric/definition to the consumer, OR (if genuinely\n' +
      '    neutral mechanism) annotate with `// allow-evals-content: <reason>`.',
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
