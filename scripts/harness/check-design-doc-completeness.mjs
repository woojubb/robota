#!/usr/bin/env node

/**
 * Design / LLD document STRUCTURE completeness gate (RULE-009).
 *
 * The design/LLD type owns component-internal realization. This guard validates the STRUCTURE of any
 * design doc that EXISTS — it does NOT assert that a doc must exist (the "when required" judgment is
 * process guidance in the `design-doc-authoring` skill, not mechanically detectable).
 *
 * Scope: package-local design docs under `packages/<pkg>/docs/design/**.md`. (Cross-cutting design
 * docs under `.agents/specs/` are validated when explicitly passed as an argument; they are not
 * auto-discovered because that folder also holds non-design specs.)
 *
 *   MUST sections (blocking): Context & Goal, Constraints, Internal Structure, Key Flows, Test Approach.
 *   SHOULD (warning): a link to the owning SPEC.md.
 *
 * Usage: `node scripts/harness/check-design-doc-completeness.mjs [path-to-dir-or-file]`
 * Exit code 0 = clean (warnings allowed; no design docs = vacuously clean), 1 = blocking findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { ADVISORY_MARKER } from './run-all-scans.mjs';
import { listManifestPackageDirs } from './workspace-packages.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

const MUST_SECTIONS = [
  { label: 'Context & Goal', re: /^##\s+Context\b/im },
  { label: 'Constraints', re: /^##\s+Constraints\b/im },
  { label: 'Internal Structure', re: /^##\s+Internal Structure\b/im },
  { label: 'Key Flows', re: /^##\s+Key Flows\b/im },
  { label: 'Test Approach', re: /^##\s+Test Approach\b/im },
];
const SPEC_LINK = /\]\([^)]*SPEC\.md[^)]*\)/;

function walkMarkdown(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/**
 * Discover package-local design docs: `packages/<pkg>/docs/design/**.md`.
 *
 * HARNESS-052: the enumeration was a depth-1 `readdir` of `packages/`, so a design doc written by
 * one of the 20 members of the nested `packages/dag-nodes/*` group would never have been validated.
 * Nesting-aware via the SSOT enumerator now.
 */
function discoverDesignDocs(root = WORKSPACE_ROOT) {
  const out = [];
  const packageDirs = listManifestPackageDirs(root);
  for (const pkgDir of packageDirs) {
    out.push(...walkMarkdown(path.join(pkgDir, 'docs', 'design')));
  }
  return { files: out, searched: packageDirs.length };
}

/**
 * Findings plus BOTH sizes (HARNESS-063): `examined` is how many design documents were read,
 * `searched` is how many locations were looked in. A zero `examined` means something different
 * depending on `searched` — nowhere to look versus the 76 packages measured here on 2026-08-01,
 * none of which authored one — and
 * the pass line has to say which.
 */
export function findDesignDocFindings(target, root = WORKSPACE_ROOT) {
  const blocking = [];
  const warnings = [];
  let files;
  let searched;
  if (target) {
    files = existsSync(target) && statSync(target).isFile() ? [target] : walkMarkdown(target);
    searched = 1;
  } else {
    ({ files, searched } = discoverDesignDocs(root));
  }
  const examined = files.length;
  for (const file of files) {
    const rel = path.relative(WORKSPACE_ROOT, file);
    const text = readFileSync(file, 'utf8');
    for (const s of MUST_SECTIONS) {
      if (!s.re.test(text)) blocking.push({ file: rel, detail: `missing "## ${s.label}" section` });
    }
    if (!SPEC_LINK.test(text)) {
      warnings.push({ file: rel, detail: 'no link to the owning SPEC.md — recommended' });
    } else {
      // RULE-013 (T-12): the link must be bidirectional. A design doc that points at its SPEC while
      // the SPEC does not point back is unreachable from the contract a reader starts at — the whole
      // reason the whitebox material sat inside SPEC.md in the first place was that no other
      // location was discoverable from there.
      // Walk up to the `docs/` directory rather than assuming two levels: `walkMarkdown` recurses,
      // so a doc at `docs/design/<topic>/<file>.md` would otherwise resolve to a non-existent
      // `docs/design/SPEC.md` and the check would silently no-op — fail-open, the shape this change
      // exists to remove.
      let docsDir = path.dirname(file);
      while (path.basename(docsDir) !== 'docs' && path.dirname(docsDir) !== docsDir) {
        docsDir = path.dirname(docsDir);
      }
      const owningSpec = path.join(docsDir, 'SPEC.md');
      if (existsSync(owningSpec) && !/docs\/design\//.test(readFileSync(owningSpec, 'utf8'))) {
        warnings.push({
          file: path.relative(WORKSPACE_ROOT, owningSpec),
          detail: 'owns a docs/design/ document but does not link to it — link is one-way',
        });
      }
    }
  }
  return { blocking, warnings, examined, searched };
}

export function main(argv = process.argv) {
  const arg = argv[2];
  const target = arg ? path.resolve(WORKSPACE_ROOT, arg) : undefined;
  const { blocking, warnings, examined, searched } = findDesignDocFindings(target);
  const location = target ? 'target path' : 'package design director(y/ies)';
  for (const w of warnings) process.stdout.write(`- [warn] ${w.file}: ${w.detail}\n`);
  if (blocking.length === 0) {
    // HARNESS-052 asked this scan's subject to be DECIDED, because it has never validated a
    // document: `packages/*/docs/design/` matches nothing and has since the scan was written, so
    // `design-doc completeness scan passed.` was a green over an empty set — indistinguishable from
    // a run that checked something. The decision recorded here is the one the scan was built with
    // and the `design-doc-authoring` skill already states: the design/LLD type is OPTIONAL; only
    // its STRUCTURE is mechanically enforceable, and "when is a design doc required" is a judgement
    // this guard cannot make. What was missing was saying so out loud, so the count is now in the
    // pass line and a zero-document run raises an advisory (HARNESS-053's third channel) instead of
    // rendering as an ordinary tick.
    if (examined === 0) {
      process.stdout.write(
        `${ADVISORY_MARKER} design-doc completeness examined 0 documents in ${searched} ` +
          `${location} — the design/LLD type is OPTIONAL (RULE-009), so this is a measured zero, ` +
          'not a validated corpus.\n',
      );
    }
    process.stdout.write(
      `design-doc completeness scan passed (${examined} design document(s) examined in ` +
        `${searched} ${location}).\n`,
    );
    return;
  }
  process.stdout.write(
    `design-doc completeness scan failed (${examined} design document(s) examined in ` +
      `${searched} ${location}):\n`,
  );
  for (const f of blocking) process.stdout.write(`- [missing-section] ${f.file}: ${f.detail}\n`);
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
