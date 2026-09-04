#!/usr/bin/env node

/**
 * SEC-008 — every remote transport must ANSWER the admission question.
 *
 * ## What went wrong without this
 *
 * Admission was not a member of any contract, so each transport re-decided it and they disagreed.
 * Two siblings made opposite default choices for one question — WS auto-minted a credential unless
 * told to stay open, WebRTC's secret was optional and absent by default — and a third, HTTP, had no
 * gate at all: `POST /submit` reached the session and ran the prompt. Nothing mechanical noticed,
 * because there was nothing for a machine to look at. A convention each implementation may or may
 * not follow is not a trust boundary.
 *
 * Fixing the three transports does not close that. The next one re-decides it again. This scan is
 * what makes the decision unavoidable: a package that carries a remote transport must reference the
 * shared admission seam, or declare in writing why it has no admission decision to make.
 *
 * ## What it checks
 *
 * For each `packages/agent-transport-*` package that is REMOTE (a peer reaches it over a wire),
 * exactly one of:
 *
 *  - its `src/**` references the shared admission seam (`resolveAdmission` from the contract
 *    package) — the transport asks the one place that owns the decision; or
 *  - the package declares `transport-admission: none — <reason>` in its `docs/SPEC.md`, which is how
 *    a transport with no remote peer says so.
 *
 * A LOCAL transport (a TUI writing to this process's terminal, a GUI bridge inside one app) has no
 * remote peer and nothing to admit. Those are not guessed at: the scan asks for the declaration, so
 * "local" is a statement someone made rather than a property the scan inferred.
 *
 * ## Which way its enumeration fails
 *
 * fail-direction: refuse — the subject list is built by GLOBBING `packages/agent-transport-*`, not
 * from a hand-maintained list of known transports. A new transport is therefore IN scope the moment
 * it exists, and a scan that cannot find its answer fails rather than passing it over. An allowlist
 * here would have the opposite direction: the gap would be a silent pass, which is exactly how the
 * three transports shipped without a boundary in the first place.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';
import { loadHarnessConfig } from './harness-config.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const TRANSPORT_PREFIX = 'agent-transport';
/** The workspace-relative tree this scan cannot judge without. */
const GOVERNED_TREE = 'packages';
/** The one function that owns the decision. Referencing it IS the answer. */
const SEAM = 'resolveAdmission';
/**
 * The package that owns the seam, built from the CONFIGURED scope rather than baked in.
 *
 * A hardcoded scope does not fail when the scope changes — it matches nothing, and matching nothing
 * reads exactly like a clean pass.
 */
function seamPackage() {
  return `${loadHarnessConfig().npmScopePrefix}agent-transport-protocol`;
}
/** How a package with no remote peer declares it. */
const DECLARATION = /transport-admission:\s*none\s*[—-]\s*\S/;

/** Every `src` file under a package, excluding tests and build output. */
function sourceFiles(packageDir) {
  const root = path.join(packageDir, 'src');
  if (!existsSync(root)) return [];
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue;
        walk(full);
        continue;
      }
      // `.tsx` too, and review is why: a transport whose admission call sat in a `.tsx` file — a
      // browser-adjacent one, which is exactly where a remote transport lives — would be invisible
      // to this walk and would have to satisfy the check through its SPEC declaration instead. Every
      // `agent-transport-*` package is plain `.ts` today, so this is not a live miss; it is the miss
      // the next one would hit, and the failure would read as "you did not call the seam" when the
      // truth was "nobody looked".
      const isSource =
        (entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.d.ts');
      if (isSource && !entry.includes('.test.')) {
        found.push(full);
      }
    }
  };
  walk(root);
  return found;
}

/** The transport packages in scope, discovered rather than listed. */
export function transportPackages(root = WORKSPACE_ROOT) {
  const packagesDir = path.join(root, 'packages');
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir)
    .filter((name) => name.startsWith(TRANSPORT_PREFIX))
    .map((name) => path.join(packagesDir, name))
    .filter((dir) => statSync(dir).isDirectory());
}

export function findAdmissionFindings(root = WORKSPACE_ROOT) {
  // Fail closed. Over a root with no `packages/` this would find no transports and report no
  // findings — which reads as "every transport answers" when the truth is that none was examined.
  requireGovernedTree(root, GOVERNED_TREE, {
    scan: 'transport-admission',
    why: 'the transports it judges live there, so its subject list would be empty rather than clean.',
  });
  const findings = [];
  for (const packageDir of transportPackages(root)) {
    const name = path.basename(packageDir);
    const spec = path.join(packageDir, 'docs', 'SPEC.md');
    if (existsSync(spec) && DECLARATION.test(readFileSync(spec, 'utf8'))) continue;

    const seam = seamPackage();
    const referencesSeam = sourceFiles(packageDir).some((file) => {
      const text = readFileSync(file, 'utf8');
      return text.includes(SEAM) && text.includes(seam);
    });
    if (referencesSeam) continue;

    findings.push({ package: name, spec: path.relative(root, spec) });
  }
  return findings;
}

function main() {
  const packages = transportPackages();
  const findings = findAdmissionFindings();
  // The size of what was examined, so an empty subject list cannot read as a clean pass.
  console.log(`::examined:: ${packages.length} transport package(s)`);
  if (packages.length === 0) {
    console.error(
      'transport-admission scan FAILED — no `packages/agent-transport-*` package was found. ' +
        'Either the layout moved or this scan is looking in the wrong place; it does not report a ' +
        'pass over nothing.',
    );
    process.exit(1);
  }
  if (findings.length === 0) {
    console.log('transport-admission scan passed.');
    process.exit(0);
  }
  console.error('transport-admission scan FAILED — a transport with no admission answer:');
  for (const finding of findings) {
    console.error(`  ${finding.package}`);
  }
  console.error(
    `\nSEC-008: admission must be decided by the shared seam, not re-decided per transport.\n` +
      `  - Call \`${SEAM}\` from ${seamPackage()} and gate on its result; or\n` +
      `  - if this transport has no remote peer, say so in its docs/SPEC.md:\n` +
      `      transport-admission: none — <why there is nothing to admit>\n` +
      `  Omitting both is how three transports shipped without a trust boundary.`,
  );
  process.exit(1);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
