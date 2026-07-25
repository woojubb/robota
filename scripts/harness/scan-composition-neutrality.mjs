#!/usr/bin/env node

/**
 * ARCH-005 — the composition-neutrality mechanical floor. Enforces the three R1 guards that make the
 * `agent-product` L129 carve-out safe: `assembleProduct` may be a published, shared assembler ONLY while it
 * remains a pure, IO-free, product-neutral fold. The amended project-structure L129 rule is COUPLED to
 * these guards — the rule relaxation is only ever true while they hold.
 *
 * For each package listed under `compositionNeutrality` in `.agents/harness.config.json`, three checks:
 *
 *  (a) Dependency-graph neutrality — the package's `package.json` declares NO concrete transport/TUI/CLI
 *      dependency (exact names in `forbiddenDependencies`, prefix matches in `forbiddenDependencyPrefixes`)
 *      in dependencies/devDependencies/peerDependencies. The assembler must never pull a concrete
 *      transport, the TUI, or the CLI — those are injected via the profile.
 *  (b) Purity / no-IO — no `src/` file imports a forbidden IO module (`node:fs`, …) or uses a forbidden
 *      IO identifier (`process.env`, settings/file readers). All resolved data is fed IN from the shell.
 *  (c) No product-name conditionals — no `src/` file branches on a product identity: `X.id === '…'` /
 *      `X.agentName === '…'` (and `!==`). This is what upgrades "profile-driven" into "hard-codes no
 *      product's choices".
 *
 * A configured package whose `src/` or `package.json` is missing is a hard SCAN-TARGET-MISSING finding, not
 * a silent pass (mirrors the check-dependency-direction purity guard — a dead guard is a defect).
 *
 * The content checks are exported as pure functions so the test can prove each guard FAILS on a planted
 * violation. Exit 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { loadHarnessConfig } from './harness-config.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/** Collect all `.ts`/`.tsx` files under a src tree (tests included — the guard is total), relative to root. */
function walkTsFiles(target, root = WORKSPACE_ROOT) {
  const full = path.join(root, target);
  if (!existsSync(full)) return [];
  const out = [];
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) out.push(...walkTsFiles(child, root));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) out.push(child);
  }
  return out;
}

/** (a) Forbidden dependencies declared in a manifest (exact names + prefix matches). Pure. */
export function findForbiddenDependencies(manifest, rule) {
  const findings = [];
  const exact = new Set(rule.forbiddenDependencies ?? []);
  const prefixes = rule.forbiddenDependencyPrefixes ?? [];
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = manifest[section];
    if (!deps) continue;
    for (const dep of Object.keys(deps)) {
      const prefixHit = prefixes.find((prefix) => dep.startsWith(prefix));
      if (exact.has(dep) || prefixHit !== undefined) {
        findings.push({
          kind: 'forbidden-dependency',
          id: dep,
          detail: `declared in [${section}]`,
        });
      }
    }
  }
  return findings;
}

/** True when the match at `index` sits inside a line comment (`//`) or an obvious block/JSDoc comment line. */
function inComment(line, index) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return true;
  const lineComment = line.indexOf('//');
  return lineComment !== -1 && lineComment < index;
}

/** (b) IO violations in a source string — forbidden module imports + forbidden IO identifiers. Pure. */
export function findIoViolations(source, file, rule) {
  const findings = [];
  const forbiddenImports = rule.forbiddenImports ?? [];
  const forbiddenIdentifiers = rule.forbiddenIdentifiers ?? [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    for (const mod of forbiddenImports) {
      const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?:from|import)\\s+['"]${escaped}['"]`);
      const m = re.exec(line);
      if (m && !inComment(line, m.index)) {
        findings.push({ kind: 'forbidden-io-import', id: mod, file, line: i + 1, text: line.trim().slice(0, 120) });
      }
    }

    for (const ident of forbiddenIdentifiers) {
      const escaped = ident.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Word-ish boundary: the identifier not immediately preceded/followed by another identifier char
      // (so `process.env` matches but `myReadSettings` / `readSettingsSafe` do not).
      const re = new RegExp(`(?<![\\w$.])${escaped}(?![\\w$])`);
      const m = re.exec(line);
      if (m && !inComment(line, m.index)) {
        findings.push({ kind: 'forbidden-io-identifier', id: ident, file, line: i + 1, text: line.trim().slice(0, 120) });
      }
    }
  }
  return findings;
}

/** A product-identity conditional: `X.id === '…'` / `X.agentName !== '…'` (equality against a string literal). */
const PRODUCT_NAME_CONDITIONAL = /\.(id|agentName)\s*(?:===|!==)\s*['"]/;

/** (c) Product-name conditionals in a source string. Pure. */
export function findProductNameConditionals(source, file) {
  const findings = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = PRODUCT_NAME_CONDITIONAL.exec(line);
    if (m && !inComment(line, m.index)) {
      findings.push({
        kind: 'product-name-conditional',
        file,
        line: i + 1,
        text: line.trim().slice(0, 120),
      });
    }
  }
  return findings;
}

/** Run all three checks over the configured packages against the real tree. */
export function scanCompositionNeutrality(root = WORKSPACE_ROOT, rules = loadHarnessConfig().compositionNeutrality ?? []) {
  const findings = [];
  for (const rule of rules) {
    const srcRel = path.join(rule.dir, 'src');
    const pkgJsonRel = path.join(rule.dir, 'package.json');
    const srcAbs = path.join(root, srcRel);
    const pkgJsonAbs = path.join(root, pkgJsonRel);

    if (!existsSync(srcAbs) || !statSync(srcAbs).isDirectory()) {
      findings.push({ kind: 'scan-target-missing', id: srcRel, detail: 'src/ dir does not exist' });
    }
    if (!existsSync(pkgJsonAbs)) {
      findings.push({ kind: 'scan-target-missing', id: pkgJsonRel, detail: 'package.json does not exist' });
    }

    if (existsSync(pkgJsonAbs)) {
      const manifest = JSON.parse(readFileSync(pkgJsonAbs, 'utf8'));
      findings.push(...findForbiddenDependencies(manifest, rule).map((f) => ({ ...f, dir: rule.dir })));
    }

    if (existsSync(srcAbs)) {
      for (const rel of walkTsFiles(srcRel, root)) {
        const source = readFileSync(path.join(root, rel), 'utf8');
        findings.push(...findIoViolations(source, rel, rule));
        findings.push(...findProductNameConditionals(source, rel));
      }
    }
  }
  return findings;
}

function main() {
  const findings = scanCompositionNeutrality();
  if (findings.length === 0) {
    console.log('composition-neutrality scan passed.');
    process.exit(0);
  }
  console.error('composition-neutrality scan FAILED — a product-composition assembler broke a neutrality guard:');
  for (const f of findings) {
    const loc = f.file ? `${f.file}:${f.line}` : (f.dir ?? f.id);
    console.error(`  [${f.kind}] ${loc}  ${f.text ?? f.detail ?? f.id ?? ''}`.trimEnd());
  }
  console.error(
    '\nThe ARCH-005 L129 carve-out holds ONLY while the assembler stays pure, IO-free, and product-neutral:\n' +
      '  (a) no concrete transport/TUI/CLI dependency,\n' +
      '  (b) no fs/env/settings read in src (resolved data is fed in from the shell),\n' +
      '  (c) no product-identity conditional (`X.id === "…"` / `X.agentName === "…"`).\n' +
      'Fix the assembler, not the guard.',
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
