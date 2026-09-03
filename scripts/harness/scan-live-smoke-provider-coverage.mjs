#!/usr/bin/env node

/**
 * INFRA-061 — mechanical floor: every remote provider the workspace defines must have its credential
 * passed through to the live provider smoke.
 *
 * ## Why this is a scan and not a note
 *
 * `scripts/harness/live-provider-smoke.mjs` says of itself:
 *
 *   "The provider list and the env-var names are read from the provider DEFINITIONS, so a newly
 *    added provider is covered automatically and this file holds no provider-name table."
 *
 * That is true of the SCRIPT and false of the SYSTEM. The script discovers providers at runtime, but
 * it can only ever see an env var that the workflow handed it, and `.github/workflows/
 * live-provider-smoke.yml` does hold a provider-name table — five hand-written `secrets.*` lines.
 * Add a seventh provider tomorrow and the script will dutifully discover it, find its key unset,
 * classify it `skipped`, and exit 0. The nightly stays green while covering one provider fewer than
 * it claims to.
 *
 * That failure is invisible from the outside: a skip and an absent secret look identical, and the
 * run is green either way. It is the same shape as the audited defect that prompted this scan — a
 * check whose green means "nothing was examined" — so the rule is mechanical rather than prose.
 *
 * ## What is flagged
 *
 * Any `$ENV:<NAME>` apiKey reference declared by a provider definition under the source tree of a
 * `packages/agent-provider-…` package, whose `<NAME>` does not appear in the live-smoke workflow.
 * Two literal shapes are resolved, because both are in use:
 *
 *   const DEFAULT_X_API_KEY_ENV = 'X_API_KEY';                    // then `$ENV:${DEFAULT_X_API_KEY_ENV}`
 *   const DEFAULT_OPENAI_..._REFERENCE = '$ENV:OPENAI_API_KEY';   // direct literal
 *
 * Test files are excluded: their fixture definitions name env vars that no real provider uses, and
 * requiring those in the workflow would be exactly the over-broad check this repo keeps paying for.
 * Local/self-hosted definitions carry a literal apiKey (no `$ENV:`) and so are never flagged — there
 * is no remote credential to provision.
 *
 * ## Why the scope stops at `agent-provider-` packages
 *
 * Measured, not assumed. Every concrete provider definition in the workspace lives under
 * `packages/agent-provider-*` today (the only `provider-definition.ts` outside it is agent-core's
 * INTERFACE). Widening to all packages was tried and rejected: `$ENV:` also appears in ordinary prose
 * and error strings — `"…stored as environment variable references ($ENV:VAR_NAME)…"`, `($ENV:VAR)` in
 * a doc comment — which the reference pattern happily matches, so the scan would demand repo secrets
 * named `VAR` and `VAR_NAME`. Phantom requirements are how a guard earns its wholesale suppression.
 *
 * The cost of the narrower scope is stated plainly: a provider definition shipped from a package NOT
 * named `agent-provider-…` would not be seen here. That is the bound of this floor, not an oversight.
 *
 * Exit 0 = every declared provider credential is wired through, 1 = findings.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { stripComments } from './scan-ci-base-history.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/** The workflow that must hand the credentials to the smoke script. */
export const SMOKE_WORKFLOW = '.github/workflows/live-provider-smoke.yml';

/** Where provider definitions live. */
const PROVIDER_PACKAGE_PREFIX = 'agent-provider-';

/** `$ENV:SOME_NAME` written directly in a string literal. */
const DIRECT_REFERENCE = /\$ENV:([A-Z][A-Z0-9_]*)/g;

/** `$ENV:${SOME_CONST}` — a template referring to a constant declared elsewhere in the package. */
const TEMPLATE_REFERENCE = /\$ENV:\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g;

/** `const NAME = 'VALUE';` / `export const NAME = "VALUE";` — the constant the template resolves to. */
const CONST_DECLARATION = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*['"]([^'"]+)['"]/g;

function isTestFile(relativePath) {
  const norm = relativePath.replace(/\\/g, '/');
  return (
    norm.includes('/__tests__/') ||
    norm.includes('/__fixtures__/') ||
    /\.(?:test|spec)\.[cm]?tsx?$/.test(norm)
  );
}

function walkSourceFiles(dir, root) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkSourceFiles(full, root));
    } else if (entry.isFile() && /\.[cm]?tsx?$/.test(entry.name)) {
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (!isTestFile(rel)) out.push(rel);
    }
  }
  return out;
}

/**
 * Pure extraction (exposed for tests): the set of env-var names a body of provider source declares as
 * `$ENV:` apiKey references. `sources` is a map of relative path → file text, all from one package, so
 * a constant declared in `defaults.ts` resolves for a template in `provider-definition.ts`.
 */
export function declaredCredentialEnvVars(sources) {
  const constants = new Map();
  for (const text of Object.values(sources)) {
    for (const match of text.matchAll(CONST_DECLARATION)) {
      constants.set(match[1], match[2]);
    }
  }

  const found = new Map();
  for (const [file, text] of Object.entries(sources)) {
    for (const match of text.matchAll(DIRECT_REFERENCE)) {
      if (!found.has(match[1])) found.set(match[1], file);
    }
    for (const match of text.matchAll(TEMPLATE_REFERENCE)) {
      const resolved = constants.get(match[1]);
      // An unresolvable template is NOT a finding: it means the constant is imported from outside
      // this package, and inventing a name from it would produce a phantom requirement.
      if (resolved !== undefined && !found.has(resolved)) found.set(resolved, file);
    }
  }
  return found;
}

/** Every provider-package source file, grouped by package directory name. */
function collectProviderSources(root = WORKSPACE_ROOT) {
  const packagesRoot = path.join(root, 'packages');
  const byPackage = new Map();
  if (!existsSync(packagesRoot)) return byPackage;

  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(PROVIDER_PACKAGE_PREFIX)) continue;
    const srcDir = path.join(packagesRoot, entry.name, 'src');
    if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) continue;

    const sources = {};
    for (const rel of walkSourceFiles(srcDir, root)) {
      sources[rel] = readFileSync(path.join(root, rel), 'utf8');
    }
    if (Object.keys(sources).length > 0) byPackage.set(entry.name, sources);
  }
  return byPackage;
}

/**
 * Env vars the workflow actually BINDS to a secret, i.e. `NAME: ${{ secrets.… }}` on a real,
 * non-comment line.
 *
 * Deliberately not `workflowText.includes(NAME)`. That was this scan's own first implementation, and
 * it passed the red-proof it was written for: the workflow's header comment lists every secret it
 * consumes by name, so a credential deleted from the `env:` block was still "found" in the prose two
 * screens above. A check satisfied by a mention rather than a wiring is the `agent-server-boundary`
 * failure — vacuously true, and green forever. Binding to `secrets.` is the thing that has effect, so
 * that is what is required.
 */
export function boundSecretEnvVars(workflowText) {
  const bound = new Set();
  for (const line of stripComments(String(workflowText ?? '')).split(/\r?\n/)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*:\s*\$\{\{\s*secrets\./.exec(line);
    if (match) bound.add(match[1]);
  }
  return bound;
}

export function findUncoveredProviderCredentials(root = WORKSPACE_ROOT) {
  const workflowPath = path.join(root, SMOKE_WORKFLOW);
  if (!existsSync(workflowPath)) {
    return [{ envVar: '(none)', file: SMOKE_WORKFLOW, kind: 'workflow-missing' }];
  }
  const bound = boundSecretEnvVars(readFileSync(workflowPath, 'utf8'));

  const findings = [];
  let declaredCount = 0;
  for (const sources of collectProviderSources(root).values()) {
    for (const [envVar, file] of declaredCredentialEnvVars(sources)) {
      declaredCount += 1;
      if (bound.has(envVar)) continue;
      findings.push({ envVar, file, kind: 'credential-not-wired' });
    }
  }

  // FAIL CLOSED on an empty subject. Measured during INFRA-061 against the HARNESS-052 probe: with
  // the workflow present but no provider packages found, this scan discovered zero declarations,
  // reported zero findings and PASSED — a guard whose green meant "there was nothing to check". A
  // renamed package prefix or a moved provider tree would have produced exactly that. This
  // repository always has provider packages, so "none discovered" is a broken scan, never a clean
  // one, and the distinction has to be mechanical because the two look identical from the outside.
  if (declaredCount === 0) {
    findings.push({
      envVar: '(none)',
      file: 'packages/agent-provider-*',
      kind: 'no-provider-declarations-found',
    });
  }

  return findings.sort((a, b) => a.envVar.localeCompare(b.envVar));
}

function main() {
  const findings = findUncoveredProviderCredentials();
  if (findings.length === 0) {
    console.log('live-smoke-provider-coverage scan passed.');
    process.exit(0);
  }
  console.error(
    'live-smoke-provider-coverage scan FAILED — a provider credential never reaches the live smoke:',
  );
  for (const finding of findings) {
    console.error(`  [${finding.kind}] ${finding.envVar}  declared in ${finding.file}`);
  }
  console.error(
    `\nThe smoke script discovers providers at runtime, but it can only read an env var that\n` +
      `${SMOKE_WORKFLOW} hands it. An unwired credential is not an error there — the provider is\n` +
      `classified "skipped" and the nightly stays GREEN while covering one provider fewer than its\n` +
      `name claims. Fix by adding the variable to that workflow's smoke step, e.g.\n` +
      `      <NAME>: \${{ secrets.<NAME> }}\n` +
      `(the secret itself does not have to exist yet — an unprovisioned secret expands to '' and the\n` +
      `provider is skipped, which is the documented and intended behaviour).`,
  );
  process.exit(1);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
