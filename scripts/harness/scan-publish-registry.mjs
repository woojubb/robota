#!/usr/bin/env node

/**
 * An authorization document with no reader is not a gate.
 *
 * `.agents/publish-registry.md` is the only thing standing between the workspace and the npm scope,
 * and until this scan existed **nothing read it** — `grep -n "publish-registry" scripts/harness/*.mjs`
 * returned nothing. It drifted in both directions at once, which is what an unread document does:
 *
 * - **13 publishable packages were outside it** — every provider package, `agent-product`,
 *   `pack-coding`, `agent-transport-webrtc` and more. They ship with `private` unset and the document
 *   that claims to authorize publishing had never heard of them.
 * - **6 names in it are not packages at all** — five `@robota-sdk/plugin-*` entries listed as
 *   beta-published, and a consolidated `@robota-sdk/agent-provider` that the repository's own SSOT
 *   (`.agents/project-structure.md`) says explicitly does not exist.
 * - **3 packages appeared in its Private table while shipping publishable**, one of them
 *   (`agent-executor`) listed in BOTH tables.
 *
 * WHAT IT CHECKS, in four rules, because each alone can be satisfied while the gate is still fiction:
 *
 *   1. COVERAGE. Every workspace package with `private !== true` must appear in the Published table.
 *      A package that npm would accept and the registry has never heard of is unauthorized by
 *      definition.
 *   2. EXISTENCE. Every package the registry names must be a real workspace package. A phantom entry
 *      is an authorization for something nobody can inspect.
 *   3. AGREEMENT. A package in the Private table must actually carry `"private": true`, must not also
 *      be in the Published table, and a Published entry must carry `publishConfig.access: "public"`.
 *   4. GRAPH. A package the registry marks Private must not be a dependency of any published package.
 *      This is the rule that decides disagreements rather than merely reporting them: three
 *      manifests contradicted the Private table, and the graph settles it — `agent-interface-transport`
 *      is a dependency of fourteen published packages, so marking it private would publish fourteen
 *      broken installs. The document was wrong; the manifests were right.
 *
 * WHAT IT CANNOT DO: it reads the registry's tables by their package-name column. It does not check
 * the npm tag, the Notes prose, or whether anything was actually published — only that the document
 * and the manifests describe the same world. A pass means the gate is CONSISTENT, never that a
 * publish is safe.
 *
 * FAIL-CLOSED: the registry file and at least one package root must exist. A run that could not read
 * either reports that rather than a pass.
 *
 * Exit code 0 = the registry and the workspace agree, 1 = they do not.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const REGISTRY_PATH = '.agents/publish-registry.md';
const PACKAGE_ROOTS = ['packages', 'apps'];

/** Every workspace manifest, as `{ name, private, access, dependencies }`. */
export function readWorkspacePackages(root) {
  const found = [];
  for (const dir of PACKAGE_ROOTS) {
    const full = path.join(root, dir);
    if (!existsSync(full)) continue;
    for (const entry of readdirSync(full)) {
      const manifest = path.join(full, entry, 'package.json');
      if (!existsSync(manifest)) continue;
      const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
      if (typeof parsed.name !== 'string') continue;
      found.push({
        name: parsed.name,
        private: parsed.private === true,
        access: parsed.publishConfig?.access,
        dependencies: Object.keys(parsed.dependencies ?? {}),
      });
    }
  }
  return found;
}

/**
 * The two tables, by the package name in each row's first cell.
 *
 * Rows are recognised by a leading backticked name in a markdown table row, which is how both tables
 * are written; prose mentioning a package elsewhere in the document is deliberately not an entry,
 * since an authorization has to be a row someone added on purpose.
 */
export function parseRegistry(markdown) {
  const sections = { published: [], private: [] };
  let current;
  for (const line of markdown.split('\n')) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      // `private` FIRST. This repository's own private heading reads "Private Packages (must NOT be
      // published)", so testing for `published` first classified the whole private table as
      // authorized — the scan's first run reported five private packages as wrongly-published and
      // missed every real disagreement. A substring test over prose is a guess; the order is what
      // makes this one decidable.
      const title = heading[1].toLowerCase();
      current = title.includes('private')
        ? 'private'
        : title.includes('published')
          ? 'published'
          : undefined;
      continue;
    }
    if (current === undefined) continue;
    const row = /^\|\s*`([^`]+)`\s*\|/.exec(line);
    if (row) sections[current].push(row[1]);
  }
  return sections;
}

export function findPublishRegistryFindings(root = WORKSPACE_ROOT) {
  const registryFile = path.join(root, REGISTRY_PATH);
  if (!existsSync(registryFile)) {
    // Fail closed: no registry is not "nothing to authorize", it is a missing gate.
    throw new Error(
      `publish-registry: ${REGISTRY_PATH} does not exist under ${root} — the publishing gate could not be read.`,
    );
  }
  const packages = readWorkspacePackages(root);
  if (packages.length === 0) {
    throw new Error(
      `publish-registry: no package manifests found under ${PACKAGE_ROOTS.join(', ')} in ${root} — nothing could be checked against the registry.`,
    );
  }

  const registry = parseRegistry(readFileSync(registryFile, 'utf8'));
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const published = new Set(registry.published);
  const privates = new Set(registry.private);
  const findings = [];

  // Rule 1 — coverage.
  for (const pkg of packages) {
    if (pkg.private || published.has(pkg.name)) continue;
    findings.push({
      rule: 'unlisted-publishable',
      detail: `${pkg.name} ships publishable (\`private\` is not true) and is in no Published table row. The registry is the only authorization for the npm scope; a package it has never heard of is not authorized.`,
    });
  }

  // Rule 2 — existence.
  for (const name of [...published, ...privates]) {
    if (byName.has(name)) continue;
    findings.push({
      rule: 'phantom-entry',
      detail: `${name} is named in the registry and is not a workspace package. An authorization for something nobody can inspect is worse than no entry.`,
    });
  }

  // Rule 3 — agreement.
  for (const name of privates) {
    const pkg = byName.get(name);
    if (pkg === undefined) continue; // already reported by rule 2
    if (published.has(name)) {
      findings.push({
        rule: 'listed-twice',
        detail: `${name} appears in BOTH tables. The document cannot both authorize and forbid it.`,
      });
    }
    if (!pkg.private) {
      findings.push({
        rule: 'private-table-disagrees',
        detail: `${name} is in the Private table and its manifest does not set \`"private": true\`. One of the two is wrong — see the dependency graph before assuming it is the manifest.`,
      });
    }
  }
  for (const name of published) {
    const pkg = byName.get(name);
    if (pkg === undefined) continue;
    if (pkg.private) {
      findings.push({
        rule: 'published-table-disagrees',
        detail: `${name} is in the Published table and its manifest sets \`"private": true\`, so it cannot be published at all.`,
      });
    } else if (pkg.access !== 'public') {
      findings.push({
        rule: 'missing-public-access',
        detail: `${name} is authorized for publishing without \`publishConfig.access: "public"\`; a scoped package defaults to restricted and the publish would not be public.`,
      });
    }
  }

  // Rule 4 — graph. The rule that settles a disagreement instead of reporting it.
  const publishedPackages = packages.filter((pkg) => !pkg.private);
  for (const name of privates) {
    const dependents = publishedPackages
      .filter((pkg) => pkg.dependencies.includes(name))
      .map((pkg) => pkg.name);
    if (dependents.length === 0) continue;
    findings.push({
      rule: 'private-dependency-of-published',
      detail: `${name} is marked Private and is a dependency of ${dependents.length} published package(s) (${dependents.slice(0, 3).join(', ')}${dependents.length > 3 ? ', …' : ''}). Publishing those would ship installs that cannot resolve it, so either it is not really private or they are not really publishable.`,
    });
  }

  return { findings, examined: packages.length };
}

function main() {
  const { findings, examined } = findPublishRegistryFindings();
  if (findings.length > 0) {
    console.error(`publish-registry scan failed: ${findings.length} finding(s):`);
    for (const finding of findings) console.error(`- [${finding.rule}] ${finding.detail}`);
    console.error(
      'The registry is the only gate on the npm scope. A document nothing reads is not a gate — see INFRA-086.',
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `publish-registry scan passed (${examined} workspace package(s) reconciled against ${REGISTRY_PATH}).`,
  );
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
