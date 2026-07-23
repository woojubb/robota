#!/usr/bin/env node

/**
 * SELFHOST-014 TC-05 — mechanical neutrality floor for the session-artifact envelope.
 *
 * The share-artifact envelope (`packages/agent-session/src/session-artifact.ts`) must stay a PURE, policy-free
 * serialize/deserialize primitive: no links, no cloud/upload, no access control, and no redaction FIELD policy.
 * All of that (link/file production, sync, access, which fields to strip for which audience) is a PRODUCT concern
 * that lives in the app surfaces, never in `packages/`. This scan FAILs if a sharing/policy token appears in the
 * envelope's CODE (comments are exempt — the module's own doc explains what it must NOT contain, using those very
 * words). Per enforcement-architecture.md: a mechanical floor, not a code-review promise.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { loadHarnessConfig } from './harness-config.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

// The envelope file under scan + its forbidden tokens are POLICY DATA in `.agents/harness.config.json`
// (`neutrality.sessionArtifactTarget` / `sessionArtifactForbiddenTokens`, HARNESS-DIET-002), not hardcoded
// here, so this engine stays repo-agnostic. The comment-stripping + match mechanics stay in the engine.
const NEUTRALITY = loadHarnessConfig().neutrality;
const TARGET_REL = NEUTRALITY.sessionArtifactTarget;
const TARGET = path.join(WORKSPACE_ROOT, TARGET_REL);

/**
 * Sharing / cloud / access / field-policy tokens that must NOT appear in the neutral envelope's code.
 * Stored as regex SOURCE strings in config; compiled here (all case-insensitive).
 */
const FORBIDDEN = NEUTRALITY.sessionArtifactForbiddenTokens.map((src) => new RegExp(src, 'i'));

/** Strip block + line comments so the module's own neutrality doc (which names these words) is exempt. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments (avoid eating `://` in a URL — but URLs are forbidden anyway)
}

function main() {
  if (!existsSync(TARGET)) {
    console.error(`session-artifact-neutrality scan: ${TARGET_REL} is missing.`);
    process.exit(1);
  }
  const code = stripComments(readFileSync(TARGET, 'utf8'));
  const findings = [];
  for (const re of FORBIDDEN) {
    const m = re.exec(code);
    if (m) findings.push(m[0]);
  }
  if (findings.length === 0) {
    console.log('session-artifact-neutrality scan passed.');
    process.exit(0);
  }
  console.error(
    'session-artifact-neutrality scan: FINDINGS — sharing/policy token(s) in the neutral envelope:',
  );
  for (const f of findings) console.error(`  - "${f}"`);
  console.error(
    '\nThe envelope is pure serialize/deserialize + schema version + the app-supplied `redact` seam. Move any ' +
      'link/cloud/access/redaction-FIELD policy to the app surface (apps/), never packages/session-artifact.ts.',
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

/** Exposed for the scan's unit test. */
export function findForbiddenTokens(source) {
  const code = stripComments(source);
  return FORBIDDEN.map((re) => re.exec(code))
    .filter(Boolean)
    .map((m) => m[0]);
}
