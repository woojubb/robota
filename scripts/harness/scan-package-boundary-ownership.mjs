#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { readWorkspaceGraph } from './workspace-graph.mjs';
import { collectWorkspaceSourceInventory } from './workspace-source-inventory.mjs';
import { extractSourceReferences } from './workspace-source-reference-extraction.mjs';
import { resolveSourceReference } from './workspace-source-reference-resolution.mjs';
import {
  extractConfigReferences,
  isRepositoryPath,
} from './workspace-source-config-resolution.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

let examined = 0;
export function examinedPopulationCount() {
  return examined;
}

const POLICY_PATH = '.agents/package-boundaries.json';
const EXCLUDED = new Set(['generated', 'vendor', 'symlink', 'missing', 'non-file']);
const referenceKey = ({ source, target, kind }) => JSON.stringify([source, target, kind]);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const exactPath = (value) =>
  nonempty(value) &&
  isRepositoryPath(value) &&
  path.posix.normalize(value) === value &&
  !/[\*?\[\]{}#]/u.test(value);
const KINDS = new Set(['module', 'execute', 'read-content', 'list-names', 'config']);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

function validatePolicy(policy) {
  const assert = (condition, message) => {
    if (!condition) throw new Error(`Invalid package boundary policy: ${message}`);
  };
  assert(
    policy?.version === 1 &&
      Array.isArray(policy.sharedCandidates) &&
      Array.isArray(policy.toolingDispositions),
    'expected version 1, sharedCandidates and toolingDispositions.',
  );
  const validateReferences = (references) => {
    const keys = new Set();
    for (const reference of references) {
      assert(
        reference &&
          exactPath(reference.source) &&
          exactPath(reference.target) &&
          KINDS.has(reference.kind),
        'references must name exact source, target and kind.',
      );
      const key = referenceKey(reference);
      assert(!keys.has(key), `duplicate reference ${key}.`);
      keys.add(key);
    }
  };
  const ids = new Set();
  for (const candidate of policy.sharedCandidates) {
    assert(
      candidate &&
        nonempty(candidate.id) &&
        nonempty(candidate.owner) &&
        exactPath(candidate.target) &&
        exactPath(candidate.contract) &&
        nonempty(candidate.domainNeutral) &&
        Array.isArray(candidate.consumers),
      'shared candidate needs id, owner, target, contract, domainNeutral and consumers.',
    );
    assert(!ids.has(candidate.id), `duplicate candidate ${candidate.id}.`);
    ids.add(candidate.id);
    validateReferences(candidate.consumers);
    assert(
      candidate.consumers.every((reference) => reference.target === candidate.target),
      `${candidate.id}: consumer target must match candidate target.`,
    );
  }
  validateReferences(policy.toolingDispositions);
  assert(
    policy.toolingDispositions.every((reference) => nonempty(reference.reason)),
    'tooling disposition reason is required.',
  );
  assert(
    policy.publicDispositions === undefined || Array.isArray(policy.publicDispositions),
    'publicDispositions must be an array.',
  );
  validateReferences(policy.publicDispositions ?? []);
  assert(
    (policy.publicDispositions ?? []).every(
      (reference) =>
        reference.kind === 'module' &&
        nonempty(reference.publicSpecifier) &&
        nonempty(reference.reason) &&
        digest(reference.binding?.exportsSha256) &&
        exactPath(reference.binding?.config?.path) &&
        digest(reference.binding?.config?.sha256),
    ),
    'public disposition needs module kind, publicSpecifier, reviewed reason and binding {exportsSha256, config:{path,sha256}}.',
  );
}

/** Manifest contract evidence is not a claim that an emitted/source file currently resolves. */
function declaresPublicSpecifier(specifier, owner, context) {
  if (!owner || !(specifier === owner.name || specifier.startsWith(`${owner.name}/`))) return false;
  if (
    /[\\%?#]/u.test(specifier) ||
    specifier.split('/').some((part) => part === '.' || part === '..')
  )
    return false;
  const manifestPath = `${owner.directory}/package.json`;
  const contract = `${owner.directory}/docs/SPEC.md`;
  if (
    !context.files.has(manifestPath) ||
    !context.files.has(contract) ||
    !context.readFile(contract).trim()
  )
    return false;
  const manifest = JSON.parse(context.readFile(manifestPath));
  // Validate declarations even when multiple runtime conditions prevent unique physical resolution.
  const safeTargets = (value) => {
    if (value === null) return true;
    if (typeof value === 'string')
      return (
        value.startsWith('./') &&
        !/[\\%?#]/u.test(value) &&
        !value
          .slice(2)
          .split('/')
          .some((part) => ['.', '..', 'node_modules'].includes(part.toLowerCase()))
      );
    if (value && typeof value === 'object') return Object.values(value).every(safeTargets);
    return false;
  };
  if (!safeTargets(manifest.exports)) return false;
  const { resolution } = resolveSourceReference(
    { source: manifestPath, kind: 'module', specifier },
    context,
  );
  return (
    resolution.evidenceInputs.includes(manifestPath) &&
    (resolution.status === 'resolved' ||
      ['missing-target', 'ambiguous-target', 'ambiguous-export'].includes(resolution.reason))
  );
}

function publicEntryTargets(owner, context) {
  const manifest = JSON.parse(context.readFile(`${owner.directory}/package.json`));
  const entries =
    manifest.exports && typeof manifest.exports === 'object'
      ? Object.keys(manifest.exports).filter((key) => key.startsWith('.'))
      : [];
  const targets = new Set();
  for (const subpath of entries.length ? entries : ['.']) {
    if (subpath.includes('*')) continue;
    const reference = {
      source: `${owner.directory}/package.json`,
      kind: 'module',
      specifier: owner.name + subpath.slice(1),
    };
    // The shared resolver is authoritative for conditions, aliasing and physical target evidence.
    const { resolution } = resolveSourceReference(reference, context);
    if (
      resolution.status === 'resolved' &&
      resolution.evidenceInputs.includes(`${owner.directory}/package.json`)
    ) {
      for (const target of resolution.targets) targets.add(target);
    }
  }
  return targets;
}

/**
 * One evidence consumer of the workspace graph/inventory, not another package graph.
 * Candidate IDs/neutrality describe reviewed contracts. Retention requires a static named import
 * of the candidate ID at the exact target, not merely an import from the same barrel.
 * Unknown references are returned unchanged, including physically unresolved public imports;
 * classifying a manifest's public contract never manufactures a resolution or cache input.
 */
export function findPackageBoundaryOwnershipFindings(root, options = {}) {
  examined = 0;
  const readFile = options.readFile ?? ((file) => readFileSync(path.join(root, file), 'utf8'));
  const graph = options.graph ?? readWorkspaceGraph(root);
  const inventory =
    options.inventory ?? collectWorkspaceSourceInventory(root, { packages: graph.packages });
  const policy = options.policy ?? JSON.parse(readFile(POLICY_PATH));
  validatePolicy(policy);
  const population = [...inventory.population, ...inventory.untrackedPopulation];
  examined = population.length;
  const byPath = new Map(population.map((entry) => [entry.path, entry]));
  const findings = [];
  const add = (code, file, message) => findings.push({ code, file, message });
  const context = {
    packages: graph.packages,
    files: inventory.files,
    readFile,
    parsedInputs: new Map(),
  };
  const references = graph.packages.flatMap((entry) => entry.sourceReferences ?? []);
  const covered = new Set(references.map((reference) => reference.source));
  for (const entry of population) {
    if (!['source', 'config'].includes(entry.category) || covered.has(entry.path)) continue;
    const extract = entry.category === 'config' ? extractConfigReferences : extractSourceReferences;
    for (const reference of extract(readFile(entry.path), entry.path)) {
      references.push(resolveSourceReference(reference, context));
    }
  }
  const actual = new Map();
  for (const reference of references) {
    if (reference.resolution?.status !== 'resolved') continue;
    for (const target of reference.resolution.targets) {
      const key = referenceKey({ ...reference, target });
      const previous = actual.get(key);
      actual.set(key, {
        ...reference,
        target,
        importedNames: [
          ...new Set([...(previous?.importedNames ?? []), ...(reference.importedNames ?? [])]),
        ],
      });
    }
  }
  for (const candidate of policy.sharedCandidates) {
    const ownerPackage = graph.packages.find((entry) => entry.name === candidate.owner);
    if (
      !ownerPackage ||
      byPath.get(candidate.target)?.owner !== candidate.owner ||
      !inventory.files.has(candidate.target) ||
      EXCLUDED.has(byPath.get(candidate.target)?.category) ||
      candidate.contract !== `${ownerPackage.directory}/docs/SPEC.md` ||
      !inventory.files.has(candidate.contract) ||
      !readFile(candidate.contract).includes(candidate.id)
    ) {
      add(
        'candidate-owner-contract',
        candidate.target,
        `${candidate.id}: target must exist under its declared package and its owner SPEC must name this contract.`,
      );
    }
    const consumers = new Set();
    for (const declaration of candidate.consumers) {
      const reference = actual.get(referenceKey(declaration));
      if (!reference) {
        add(
          'stale-declaration',
          declaration.source,
          `No actual reference to ${declaration.target} (${declaration.kind}).`,
        );
        continue;
      }
      if (reference.kind !== 'module' || !reference.importedNames.includes(candidate.id)) {
        add(
          'candidate-import-evidence',
          declaration.source,
          `${candidate.id}: no static named import of this API at ${candidate.target}.`,
        );
        continue;
      }
      const owner = byPath.get(reference.source)?.owner;
      if (graph.packages.some((entry) => entry.name === owner) && owner !== candidate.owner)
        consumers.add(owner);
    }
    if (consumers.size < 2)
      add(
        'shared-consumer-count',
        candidate.target,
        `${candidate.id}: ${consumers.size} independent package consumers; at least two required.`,
      );
  }
  const tooling = new Set(policy.toolingDispositions.map(referenceKey));
  const publicDispositions = new Set();
  for (const declaration of policy.publicDispositions ?? []) {
    const owner = graph.packages.find(
      (entry) => entry.name === byPath.get(declaration.target)?.owner,
    );
    if (!actual.has(referenceKey(declaration))) {
      add(
        'stale-declaration',
        declaration.source,
        `No actual public correspondence reference to ${declaration.target}.`,
      );
    } else if (
      !inventory.files.has(declaration.target) ||
      EXCLUDED.has(byPath.get(declaration.target)?.category) ||
      !declaresPublicSpecifier(declaration.publicSpecifier, owner, context)
    ) {
      add(
        'invalid-public-disposition',
        declaration.source,
        `Reviewed runtime target must belong to the owner of exported ${declaration.publicSpecifier}, with an existing SPEC.`,
      );
    } else if (
      sha256(JSON.stringify(JSON.parse(readFile(`${owner.directory}/package.json`)).exports)) !==
      declaration.binding.exportsSha256
    ) {
      add(
        'stale-public-binding',
        declaration.source,
        `Reviewed exports changed for ${declaration.publicSpecifier}; revalidate its exact correspondence.`,
      );
    } else if (
      path.posix.dirname(declaration.binding.config.path) !== owner.directory ||
      !/^tsdown\.config\.[cm]?[jt]s$/u.test(path.posix.basename(declaration.binding.config.path)) ||
      !inventory.files.has(declaration.binding.config.path) ||
      EXCLUDED.has(byPath.get(declaration.binding.config.path)?.category) ||
      sha256(readFile(declaration.binding.config.path)) !== declaration.binding.config.sha256
    ) {
      add(
        'stale-public-binding',
        declaration.source,
        `Reviewed owner tsdown config changed or is missing for ${declaration.publicSpecifier}.`,
      );
    } else publicDispositions.add(referenceKey(declaration));
  }
  for (const declaration of policy.toolingDispositions) {
    if (!actual.has(referenceKey(declaration)))
      add(
        'stale-declaration',
        declaration.source,
        `No actual reference to ${declaration.target} (${declaration.kind}).`,
      );
  }
  const publicTargets = new Map();
  for (const reference of actual.values()) {
    const sourceOwner = byPath.get(reference.source)?.owner;
    const targetOwner = byPath.get(reference.target)?.owner;
    if (sourceOwner === targetOwner) continue;
    if (tooling.has(referenceKey(reference))) continue;
    if (publicDispositions.has(referenceKey(reference))) continue;
    const owner = graph.packages.find((entry) => entry.name === targetOwner);
    if (owner && reference.kind === 'module') {
      if (!publicTargets.has(owner.name))
        publicTargets.set(owner.name, publicEntryTargets(owner, context));
      const contract = `${owner.directory}/docs/SPEC.md`;
      if (
        publicTargets.get(owner.name).has(reference.target) &&
        inventory.files.has(contract) &&
        readFile(contract).trim()
      )
        continue;
    }
    add(
      'unclassified-boundary',
      reference.source,
      `${reference.kind} → ${reference.target}: requires an exact tooling disposition or an owner-contracted public module entry.`,
    );
  }
  const unknownReferences = references.filter(
    (reference) => reference.resolution?.status === 'unresolved',
  );
  const packageRoots = [...graph.packages].sort((a, b) => b.directory.length - a.directory.length);
  for (const reference of unknownReferences) {
    const sourceOwner = byPath.get(reference.source)?.owner;
    const namedOwner = packageRoots.find(
      (entry) =>
        reference.specifier === entry.name || reference.specifier?.startsWith(`${entry.name}/`),
    );
    if (
      reference.kind === 'module' &&
      namedOwner &&
      ['missing-target', 'ambiguous-target', 'ambiguous-export'].includes(
        reference.resolution.reason,
      ) &&
      reference.resolution.evidenceInputs?.includes(`${namedOwner.directory}/package.json`) &&
      declaresPublicSpecifier(reference.specifier, namedOwner, context)
    )
      continue;
    let potentialOwner = namedOwner?.name;
    if (
      reference.specifier?.startsWith('.') &&
      (reference.anchor === 'source' || reference.kind === 'module')
    ) {
      const potential = path.posix.normalize(
        path.posix.join(path.posix.dirname(reference.source), reference.specifier),
      );
      potentialOwner =
        packageRoots.find((entry) => potential.startsWith(`${entry.directory}/`))?.name ??
        'repository';
    }
    if (potentialOwner !== undefined && potentialOwner !== sourceOwner) {
      add(
        'unknown-boundary',
        reference.source,
        `${reference.kind} ${reference.specifier}: unresolved cross-owner potential (${reference.resolution.reason}); not zero consumer evidence.`,
      );
    }
  }
  return {
    findings,
    unknownReferences,
    configReferences: references.filter((reference) => reference.kind === 'config'),
    counts: {
      tracked: inventory.population.length,
      untracked: inventory.untrackedPopulation.length,
      excluded: population.filter((entry) => EXCLUDED.has(entry.category)).length,
      unknownPopulation: population.filter((entry) => entry.category === 'unknown').length,
      analyzedSources: population.filter((entry) => entry.category === 'source').length,
      references: references.length,
      configReferences: references.filter((reference) => reference.kind === 'config').length,
      unknownReferences: unknownReferences.length,
    },
  };
}

export function main(options = {}, write = (text) => process.stdout.write(`${text}\n`)) {
  try {
    const result = findPackageBoundaryOwnershipFindings(
      options.root ?? resolveWorkspaceRoot(import.meta),
      options,
    );
    write(`::examined:: ${examinedPopulationCount()} inventory path dispositions`);
    const unknownReasons = new Map();
    for (const reference of result.unknownReferences) {
      const reason = reference.resolution.reason;
      unknownReasons.set(reason, (unknownReasons.get(reason) ?? 0) + 1);
    }
    // Full reference evidence remains on the finder API, not in routine CI stdout.
    // Actionable findings are never truncated; output is not a universal byte-capped report.
    write(
      JSON.stringify({
        counts: result.counts,
        unknownReasons: Object.fromEntries(
          [...unknownReasons].sort(([a], [b]) => a.localeCompare(b)),
        ),
        findings: result.findings,
      }),
    );
    write(`package-boundary-ownership ${result.findings.length ? 'FAILED' : 'PASS'}`);
    return result.findings.length ? 1 : 0;
  } catch (error) {
    write(`::examined:: ${examinedPopulationCount()} inventory path dispositions`);
    write(`package-boundary-ownership FAILED: ${error.message}`);
    return 1;
  }
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename))
  process.exitCode = main();
