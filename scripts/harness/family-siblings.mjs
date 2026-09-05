/**
 * Family rules of the `deps` scan (`check-dependency-direction.mjs` rules 7, 11, 12): a package's
 * NAME declares where it sits, and the name is the detector.
 *
 * 7.  DAG-NODES-LEAF (HARNESS-016 / ARL-16b): a `dag-node-*` leaf reaches only the node-contract
 *     owners among `dag-*` packages — never an orchestrator layer or a sibling leaf.
 * 11. FAMILY-SIBLINGS (STRUCT-012, 패키지 이름 계층 참조 규칙): an `agent-<family>-<child>` may depend
 *     on its parent `agent-<family>` and on lower families; never on a sibling `agent-<family>-<other>`
 *     at any depth. The bare parent never depends on a child, and the composer/foundation
 *     (`agent-framework`, `agent-core`) never depends on a transport or UI child. Sibling edges that
 *     predate the rule are frozen shrink-only in `family-sibling-baseline.json`.
 * 12. UNDECLARED-IMPORT (STRUCT-012): a manifest rule can be walked around by a source import the
 *     manifest never declares, so every `@robota-sdk/*` WORKSPACE package a production source file
 *     imports is declared in one of the three dependency sections.
 *
 * Rule 11 generalises rule 7's sibling clause from one family (`dag-node-*`) to every
 * `agent-<family>-*` family; the two stay side by side so the shape is read once.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadHarnessConfig } from './harness-config.mjs';
import { escapeForRegExp } from './shared.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const HARNESS = loadHarnessConfig();

/**
 * Frozen baseline (HARNESS-016 / ARL-16b): dag-node leaf-invariant exceptions, keyed by the exact
 * `"<package> -> <dep>"` edge with a reason. The former `dag-node-llm-text-router` aggregator (the only
 * node→node fan-out) is REMOVED by ARCH-PROVIDER-003 — provider DIP collapsed the five vendor nodes + router
 * into the single registry-injected `dag-node-llm-text`, so the leaf invariant now holds with no exceptions.
 * (ARL-11 node-half resolved.) New node→node / node→orchestrator edges are NOT in this set and must fail.
 */
const DAG_NODES_LEAF_ALLOWLIST = new Set([]);

/**
 * Rule 7 (HARNESS-016 / ARL-16b): a `@robota-sdk/dag-node-*` leaf package may depend, among `dag-*`
 * packages, ONLY on the node-contract owners `{dag-core, dag-node}`. Depending on an orchestrator/runtime/
 * adapter layer (`dag-runtime`/`dag-framework`/`dag-worker`/`dag-projection`/`dag-scheduler`/
 * `dag-orchestration-*`/`dag-api`/`dag-builder`/`dag-adapters-*`/…) or on a **sibling** `dag-node-*` breaks
 * the leaf invariant (a leaf must not know the orchestrator or its peers). Scope: intra-DAG leaf-ness only —
 * the cross-subsystem `dag-node-* → agent-*` assembly reach (ARL-11) is a separate invariant not policed here.
 * Scanned scope: every `packages/dag-nodes/*` package (name `@robota-sdk/dag-node-*`); allow-set = the
 * node-contract owners; exceptions frozen in `DAG_NODES_LEAF_ALLOWLIST`.
 */
export function checkDagNodesLeaf(packages) {
  const violations = [];
  const nodePrefix = `${HARNESS.npmScopePrefix}dag-node-`;
  const dagPrefix = `${HARNESS.npmScopePrefix}dag-`;
  const allowedDagTargets = new Set([
    `${HARNESS.npmScopePrefix}dag-core`,
    `${HARNESS.npmScopePrefix}dag-node`,
  ]);

  for (const [name, pkg] of packages) {
    if (!name.startsWith(nodePrefix)) continue;
    for (const dep of pkg.dependencies) {
      if (!dep.startsWith(dagPrefix)) continue; // only intra-DAG edges are policed here
      if (allowedDagTargets.has(dep)) continue;
      if (DAG_NODES_LEAF_ALLOWLIST.has(`${name} -> ${dep}`)) continue;
      violations.push({
        package: name,
        dep,
        message:
          `dag-nodes leaf violation: ${name} must not depend on ${dep}. ` +
          `A dag-node-* leaf may depend only on {dag-core, dag-node} among dag-* packages — never an ` +
          `orchestrator/runtime/adapter layer or a sibling dag-node-*.`,
      });
    }
  }

  return violations;
}

export const FAMILY_SIBLING_BASELINE_PATH = join(
  ROOT,
  'scripts/harness/family-sibling-baseline.json',
);

/** Families judged by another rule: `agent-interface-*` edges are owned by INTERFACE-DEPS (ARCH-101 map). */
const FAMILY_DELEGATED = new Set([`${HARNESS.internalPackagePrefix}interface`]);

/**
 * Packages that compose the family's children and must never depend on one (rule 11, clause v):
 * the composer depends on the contract, never on a per-concern child.
 */
const FAMILY_COMPOSERS = new Set([
  HARNESS.corePackage,
  `${HARNESS.internalPackagePrefix}framework`,
]);
const FAMILY_CHILD_PREFIXES_CLOSED_TO_COMPOSERS = [
  `${HARNESS.internalPackagePrefix}transport-`,
  `${HARNESS.internalPackagePrefix}ui-`,
];

/**
 * The family a package name declares: `@robota-sdk/agent-<family>-<rest>` → `@robota-sdk/agent-<family>`.
 * The family is the SECOND dash segment, so `agent-transport-webrtc-web` is a sibling of
 * `agent-transport-gui` and `agent-tools` (two segments) declares no family. A bare `agent-<family>`
 * package IS the family's parent, not a member.
 */
export function familyOf(name) {
  if (!name.startsWith(HARNESS.internalPackagePrefix)) return null;
  const rest = name.slice(HARNESS.internalPackagePrefix.length).split('-');
  return rest.length >= 2 ? `${HARNESS.internalPackagePrefix}${rest[0]}` : null;
}

export function readFamilySiblingBaseline(path = FAMILY_SIBLING_BASELINE_PATH) {
  if (!existsSync(path)) return new Map();
  return new Map(Object.entries(JSON.parse(readFileSync(path, 'utf8')).frozen ?? {}));
}

/**
 * Rule 11 (STRUCT-012 / FAMILY-SIBLINGS): the name hierarchy is the detector. Judged over
 * `dependencies` + `peerDependencies` (the production graph); devDependency edges are `dep-kind`'s
 * and DEV-CYCLE's business. Returns `{ violations, examined }` where `examined` counts the family
 * members judged — zero members is itself a finding (a rule that matches nothing reads as a pass).
 */
export function checkFamilySiblings(
  packages,
  { baseline = readFamilySiblingBaseline(), delegated = FAMILY_DELEGATED } = {},
) {
  const violations = [];
  const seenFrozen = new Set();
  let examined = 0;

  for (const [name, pkg] of packages) {
    const family = familyOf(name);
    const edges = [...new Set([...pkg.dependencies, ...(pkg.peerDependencies ?? [])])];

    // Clause (v): the composer/foundation never depends on a transport or UI child.
    if (FAMILY_COMPOSERS.has(name)) {
      for (const dep of edges) {
        if (FAMILY_CHILD_PREFIXES_CLOSED_TO_COMPOSERS.some((prefix) => dep.startsWith(prefix))) {
          violations.push({
            package: name,
            dep,
            message:
              `composer violation: ${name} must not depend on ${dep}. ` +
              `The composer depends on the contract (agent-interface-*), never on a per-concern child.`,
          });
        }
      }
    }

    // Clause (iv): a bare parent never depends on one of its children.
    if (!family && name.startsWith(HARNESS.internalPackagePrefix)) {
      for (const dep of edges) {
        if (familyOf(dep) === name) {
          violations.push({
            package: name,
            dep,
            message:
              `parent violation: ${name} must not depend on its child ${dep}. ` +
              `The root of a family never imports a child; shared code lives in the parent.`,
          });
        }
      }
      continue;
    }
    if (!family) continue;
    examined += 1;

    for (const dep of edges) {
      if (dep === family) continue; // clause (i): child → parent is the legal shape
      if (familyOf(dep) !== family) continue; // clause (iii): not this rule's business
      if (delegated.has(family)) continue; // judged once, by the family's own layer map
      const edge = `${name} -> ${dep}`;
      if (baseline.has(edge)) {
        seenFrozen.add(edge);
        continue;
      }
      violations.push({
        package: name,
        dep,
        message:
          `family sibling violation: ${edge}. ` +
          `${name} may depend on its parent ${family} or on a lower family, never on a sibling ` +
          `${family}-*; shared code belongs in the parent (or a parent subpath), not in a sibling.`,
      });
    }
  }

  for (const edge of baseline.keys()) {
    if (!seenFrozen.has(edge)) {
      violations.push({
        package: edge.split(' -> ')[0],
        dep: edge.split(' -> ')[1],
        message:
          `stale baseline entry: ${edge} no longer exists in the tree. ` +
          `Remove it from family-sibling-baseline.json — the freeze may only shrink.`,
      });
    }
  }

  if (examined === 0) {
    violations.push({
      package: '(none)',
      dep: '(none)',
      message:
        'zero family members examined: no agent-<family>-<child> package was found, so the rule ' +
        'judged nothing. A rule that matches nothing is a dead guard, not a pass.',
    });
  }

  return { violations, examined };
}

/**
 * Size reader for the FAMILY-SIBLINGS size declaration printed by the deps scan: the number of
 * `agent-<family>-<child>` members judged. Exported so a test asserts the exact count on a fixture
 * (measurement-provenance.md).
 */
export function readExaminedFamilyMembers(packages) {
  return checkFamilySiblings(packages).examined;
}

const SCOPE = escapeForRegExp(HARNESS.npmScopePrefix);
const IMPORT_SPECIFIER_RE = new RegExp(
  `^(?:import|export)\\s[^;]*?from\\s+['"](${SCOPE}[a-z0-9-]+)(?:/[^'"]*)?['"]`,
  'gm',
);
const SIDE_EFFECT_IMPORT_SPECIFIER_RE = new RegExp(
  `^import\\s+['"](${SCOPE}[a-z0-9-]+)(?:/[^'"]*)?['"]`,
  'gm',
);

/**
 * Rule 12 (STRUCT-012 / UNDECLARED-IMPORT): every `@robota-sdk/*` WORKSPACE package a production
 * source file imports (import/export declarations at line start — never JSDoc or template text) is
 * declared in one of `dependencies`, `peerDependencies`, `devDependencies`. "Undeclared" is absence
 * from all three — the complement `check-dep-kind.mjs` hands to this scan — so a type-only import
 * satisfied by a devDependency is not a finding. Specifiers that name no workspace package are
 * `ghost-package-refs`' business, not this rule's.
 */
export function checkUndeclaredImports(sourcePackages, packages) {
  const violations = [];
  const workspaceNames = new Set(packages.keys());
  for (const source of sourcePackages) {
    const pkg = packages.get(source.name);
    if (!pkg) continue;
    const declared = new Set(pkg.allDependencies ?? pkg.dependencies);
    for (const file of source.files) {
      if (/(^|\/)__tests__\//.test(file.path) || /\.(test|spec)\.[cm]?tsx?$/.test(file.path))
        continue;
      const seen = new Set();
      for (const re of [IMPORT_SPECIFIER_RE, SIDE_EFFECT_IMPORT_SPECIFIER_RE]) {
        re.lastIndex = 0;
        for (const match of file.text.matchAll(re)) {
          const specifier = match[1];
          if (specifier === source.name || seen.has(specifier)) continue;
          if (!workspaceNames.has(specifier) || declared.has(specifier)) continue;
          seen.add(specifier);
          violations.push({
            package: source.name,
            dep: specifier,
            message:
              `undeclared import: ${file.path} imports ${specifier}, which ${source.name}/package.json ` +
              `declares in none of dependencies, peerDependencies or devDependencies.`,
          });
        }
      }
    }
  }
  return violations;
}
