#!/usr/bin/env node

/**
 * TEST-003 functional-coverage check.
 *
 * Enforces the testing-layering rule mechanically: every framework capability the CLI exposes must
 * have a kit-based functional test that drives a REAL InteractiveSession through
 * @robota-sdk/agent-framework/testing — not a CLI-surface test, not a skipped E2E.
 *
 * The manifest (functional-coverage-manifest.json) lists each capability and its functional test.
 * This check fails when a listed test file is missing or does not reference the functional harness.
 * Adding a framework capability without a manifest row + harness test is the regression this guards.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { blankComments } from './lib/blank-comments.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const MANIFEST_PATH = path.join(import.meta.dirname, 'functional-coverage-manifest.json');

/**
 * Strip block and line comments so a marker MENTIONED in a comment is not evidence of use.
 *
 * HARNESS-052 sub-shape A: this check claimed "every framework capability … drives a REAL
 * InteractiveSession" while accepting `source.includes('scriptedSession')` — true of the token in a
 * comment beside a `describe.skip`, which is the precise case its own docstring forbids.
 *
 * Issue #2258: delegates to the offset-preserving owner in `lib/blank-comments.mjs` rather than
 * keeping a second, collapsing implementation. Every byte of a comment becomes a space and newlines
 * survive, so a caller that indexes into the result still indexes into the original; a `//` inside
 * a string or regex literal no longer opens a false comment either.
 */
export function stripComments(sourceText) {
  return blankComments(String(sourceText ?? ''));
}

/** Is the harness marker actually CALLED (or constructed / used as a type argument) here? */
export function usesMarker(code, marker) {
  const escaped = String(marker).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:new\\s+)?\\b${escaped}\\s*[(<]`).test(String(code ?? ''));
}

/**
 * The [start, end) spans of `describe.skip(...)` / `describe.todo(...)` blocks.
 *
 * Parenthesis counting, not a regex: a suite body is arbitrary code, and the only way to know where
 * one ends is to count. Strings containing unbalanced parens would confuse it, which is stated
 * rather than hidden — the alternative is parsing, and this file is a grep-level guard by design.
 */
export function skippedSuiteSpans(code) {
  const spans = [];
  const opener = /\bdescribe((?:\s*\.\s*[A-Za-z]+(?:\([^()]*\))?)*)\s*\(/g;
  for (const match of code.matchAll(opener)) {
    if (!/\b(?:skip|todo|skipIf)\b/.test(match[1] ?? '')) continue;
    let depth = 0;
    let end = code.length;
    for (let i = match.index + match[0].length - 1; i < code.length; i++) {
      const c = code[i];
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    spans.push([match.index, end]);
  }
  return spans;
}

/**
 * Does the file declare at least one test that is not skipped?
 *
 * The manifest's contract is "not a skipped E2E". A file whose every case is `it.skip` still
 * contains the marker, still passes a substring check, and covers nothing. Deliberately narrow: a
 * PARTIALLY skipped file is fine — flagging those would fire on legitimate work, and a guard that
 * fires on correct data is one that gets suppressed.
 *
 * A case inside a `describe.skip(...)` block does not run either, and the first version of this
 * check read only the modifiers attached to `it`/`test` — so a whole suite wrapped in
 * `describe.skip` counted as live coverage. That is the same paper-coverage this check was added
 * to catch, in its most common spelling.
 */
export function hasLiveTest(code) {
  const source = String(code ?? '');
  const skipped = skippedSuiteSpans(source);
  const declarations = source.matchAll(
    /\b(?:it|test)((?:\s*\.\s*[A-Za-z]+(?:\([^()]*\))?)*)\s*\(/g,
  );
  for (const match of declarations) {
    if (/\b(?:skip|todo|skipIf)\b/.test(match[1] ?? '')) continue;
    if (skipped.some(([start, end]) => match.index > start && match.index < end)) continue;
    return true;
  }
  return false;
}

/**
 * Pure finding collector. Returns { findings, capabilityCount }; `findings` non-empty means the
 * check fails. Manifest-shape violations (missing/invalid manifest, empty markers/capabilities)
 * are findings of the same kind — the CLI wrapper prints them identically to the original.
 */
export function collectFunctionalCoverageFindings(
  root = WORKSPACE_ROOT,
  manifestPath = MANIFEST_PATH,
) {
  if (!existsSync(manifestPath)) {
    return {
      findings: [`manifest not found: ${path.relative(root, manifestPath)}`],
      capabilityCount: 0,
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return { findings: [`manifest is not valid JSON: ${error.message}`], capabilityCount: 0 };
  }

  const markers = Array.isArray(manifest.markers) ? manifest.markers : [];
  const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  if (markers.length === 0) {
    return {
      findings: ['manifest "markers" must list at least one harness marker'],
      capabilityCount: 0,
    };
  }
  if (capabilities.length === 0) {
    return { findings: ['manifest "capabilities" is empty'], capabilityCount: 0 };
  }

  const findings = [];
  const seen = new Set();

  for (const capability of capabilities) {
    const { id, test } = capability ?? {};
    if (!id || !test) {
      findings.push(`capability entry missing "id" or "test": ${JSON.stringify(capability)}`);
      continue;
    }
    if (seen.has(id)) findings.push(`duplicate capability id: ${id}`);
    seen.add(id);

    const abs = path.join(root, test);
    if (!existsSync(abs)) {
      findings.push(`${id}: functional test not found: ${test}`);
      continue;
    }
    const code = stripComments(readFileSync(abs, 'utf8'));
    if (!markers.some((marker) => usesMarker(code, marker))) {
      findings.push(
        `${id}: ${test} does not use the functional harness (expected a call to one of: ${markers.join(', ')})`,
      );
    }
    if (!hasLiveTest(code)) {
      findings.push(
        `${id}: ${test} declares no live test — every case is skipped, so the capability is covered on paper only`,
      );
    }
  }

  return { findings, capabilityCount: capabilities.length };
}

export function main() {
  const { findings, capabilityCount } = collectFunctionalCoverageFindings();

  if (findings.length > 0) {
    console.error('✗ functional-coverage');
    for (const message of findings) console.error(`  - ${message}`);
    console.error(
      '\nEvery framework capability needs a kit-based functional test (see .agents/rules/testing-layering.md).',
    );
    process.exit(1);
  }

  console.log(
    `✓ functional-coverage (${capabilityCount} capabilit${capabilityCount === 1 ? 'y' : 'ies'})`,
  );
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
