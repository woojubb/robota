#!/usr/bin/env node

/**
 * HARNESS-027 — mechanical neutrality floor for `packages/agent-tools`.
 *
 * SELFHOST-003 (repo-map retrieval) and SELFHOST-010 (computer-use) keep their reference adapters in `agent-tools`
 * NEUTRAL: the heavy capability (source parser / browser page) is INJECTED as a duck-typed port, so NO heavy
 * third-party SDK (vector store / tree-sitter / Playwright / CDP) becomes an `agent-tools` runtime dependency.
 * Today that rests on per-feature source-import unit floors + a one-time manual grep; no `harness:scan` rule
 * fences the package's third-party dependency SET. This floor does — it fails on any non-`@robota-sdk/*` runtime
 * dependency of `agent-tools` that is not on a small documented allowlist.
 *
 * It checks the UNION of runtime-reachable dep kinds — `dependencies` ∪ `peerDependencies` ∪
 * `optionalDependencies` (a heavy SDK smuggled as a peer/optional dep dodges a `dependencies`-only scan AND the
 * source-import unit floor; agent-tools already uses `peerDependencies`, so it is a live evasion path).
 * `devDependencies` are NOT checked: agent-tools is not a bundled/INFRA-028 package (only `agent-cli` is), so its
 * devDeps (tsdown/typescript/vitest) are build/test tooling that never reaches `dist`.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { loadHarnessConfig } from './harness-config.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const PKG = path.join(WORKSPACE_ROOT, 'packages/agent-tools/package.json');

/**
 * The sanctioned third-party (non-`@robota-sdk/*`) runtime dependencies of `agent-tools` — held as POLICY DATA in
 * `.agents/harness.config.json` (`neutrality.agentToolsRuntimeAllowlist`, HARNESS-DIET-002), not hardcoded here,
 * so this engine stays repo-agnostic. Adding a dep there is a deliberate, reviewed act — the diff makes a heavy
 * SDK visible. A heavy retrieval/parser/vector/browser SDK must be injected as a duck-typed port from the surface
 * instead of depending on it here.
 */
const ALLOWLIST = new Set(loadHarnessConfig().neutrality.agentToolsRuntimeAllowlist);

/** Runtime-reachable dep kinds (excludes `devDependencies`: not shipped for this non-bundled package). */
const RUNTIME_DEP_KINDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

/** Pure (exposed for tests): the non-`@robota-sdk/*`, non-allowlisted runtime deps across all runtime kinds. */
export function findDisallowedDeps(packageJson) {
  const disallowed = new Set();
  for (const kind of RUNTIME_DEP_KINDS) {
    for (const name of Object.keys(packageJson[kind] ?? {})) {
      if (name.startsWith('@robota-sdk/')) continue; // workspace edges — governed by the `deps` scan
      if (!ALLOWLIST.has(name)) disallowed.add(name);
    }
  }
  return [...disallowed];
}

function main() {
  if (!existsSync(PKG)) {
    console.error('agent-tools-neutrality scan: packages/agent-tools/package.json is missing.');
    process.exit(1);
  }
  const disallowed = findDisallowedDeps(JSON.parse(readFileSync(PKG, 'utf8')));
  if (disallowed.length === 0) {
    console.log(
      `agent-tools-neutrality scan passed (allowlist: ${[...ALLOWLIST].sort().join(', ')}).`,
    );
    process.exit(0);
  }
  console.error(
    'agent-tools-neutrality scan: FINDINGS — disallowed third-party runtime dependency in agent-tools:',
  );
  for (const name of disallowed) console.error(`  - "${name}"`);
  console.error(
    '\nagent-tools must stay neutral: inject a heavy capability (parser / browser / vector store) as a duck-typed\n' +
      'port from the surface instead of depending on its SDK here. If a dep is genuinely sanctioned, add it to the\n' +
      'ALLOWLIST in scripts/harness/scan-agent-tools-neutrality.mjs (a deliberate, reviewed act).',
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
