import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const CATEGORY_BY_REFERENCE_KIND = new Map([
  ['STANDING_CLASS_INSTRUCTION_QUOTED', 'HISTORICAL_QUOTED_CLASS_SHAPE'],
  ['STANDING_AUTHORITY_ASSERTED', 'NO_QUOTED_AUTHORITY'],
  ['DIRECT_ITEM_OR_BATCH_APPROVAL', 'HISTORICAL_DIRECT_SHAPE'],
]);

const RELAY_REFERENCE_KINDS = new Set(['USER_AUTHORITY_RELAYED', 'RELAY_PROVENANCE_INHERITED']);

const CATEGORY_REASONS = new Map([
  ['HISTORICAL_DIRECT_SHAPE', 'HISTORICAL_DIRECT_NOT_CURRENT_AUTHORITY'],
  ['HISTORICAL_QUOTED_CLASS_SHAPE', 'RETROACTIVE_CLASS_PROHIBITED'],
  ['RELAYED_AUTHORITY_ONLY', 'RELAY_IS_NOT_AUTHORITY'],
  ['NO_QUOTED_AUTHORITY', 'VERBATIM_AUTHORITY_UNAVAILABLE'],
]);

const HEX_40 = /^[0-9a-f]{40}$/u;
const HEX_64 = /^[0-9a-f]{64}$/u;
const MANIFEST_KEYS = ['version', 'adoptionRevision', 'records'];
const RECORD_KEYS = [
  'subject',
  'path',
  'blob',
  'documentSha256',
  'evidenceLogSha256',
  'standingVerdictSha256',
  'references',
  'category',
  'disposition',
  'reason',
];
const REFERENCE_KEYS = ['kind', 'start', 'end', 'sha256'];

export function deriveDispositionCategory(references) {
  if (references.some(({ kind }) => RELAY_REFERENCE_KINDS.has(kind))) {
    return 'RELAYED_AUTHORITY_ONLY';
  }
  const categories = new Set(
    references.map(({ kind }) => CATEGORY_BY_REFERENCE_KIND.get(kind)).filter(Boolean),
  );
  return categories.size === 1 ? [...categories][0] : undefined;
}

function assertExactKeys(value, expected, owner) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${owner} must be an object`);
  }
  const actual = Object.keys(value);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${owner} keys must be exactly: ${expected.join(', ')}`);
  }
}

function assertHash(value, pattern, owner) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${owner} must be a lowercase hexadecimal digest`);
  }
}

function validateReference(reference, owner) {
  assertExactKeys(reference, REFERENCE_KEYS, owner);
  if (
    !RELAY_REFERENCE_KINDS.has(reference.kind) &&
    !CATEGORY_BY_REFERENCE_KIND.has(reference.kind)
  ) {
    throw new Error(`${owner}.kind is not a closed evidence-reference kind`);
  }
  if (
    !Number.isSafeInteger(reference.start) ||
    !Number.isSafeInteger(reference.end) ||
    reference.start < 0 ||
    reference.end <= reference.start
  ) {
    throw new Error(`${owner} must name a non-empty safe byte range`);
  }
  assertHash(reference.sha256, HEX_64, `${owner}.sha256`);
}

function validateRecord(record, index) {
  const owner = `records[${index}]`;
  assertExactKeys(record, RECORD_KEYS, owner);
  if (
    typeof record.subject !== 'string' ||
    pathBasename(record.path) !== record.subject ||
    !record.path.startsWith('.agents/spec-docs/')
  ) {
    throw new Error(`${owner} subject/path binding is invalid`);
  }
  assertHash(record.blob, HEX_40, `${owner}.blob`);
  for (const key of ['documentSha256', 'evidenceLogSha256', 'standingVerdictSha256']) {
    assertHash(record[key], HEX_64, `${owner}.${key}`);
  }
  if (!Array.isArray(record.references) || record.references.length === 0) {
    throw new Error(`${owner}.references must be a non-empty array`);
  }
  record.references.forEach((reference, referenceIndex) =>
    validateReference(reference, `${owner}.references[${referenceIndex}]`),
  );
  if (deriveDispositionCategory(record.references) !== record.category) {
    throw new Error(`${owner}.category is inconsistent with its evidence references`);
  }
  if (record.disposition !== 'PRESERVE_FROZEN') {
    throw new Error(`${owner}.disposition must be PRESERVE_FROZEN`);
  }
  if (CATEGORY_REASONS.get(record.category) !== record.reason) {
    throw new Error(`${owner}.reason is inconsistent with its category`);
  }
}

function pathBasename(value) {
  return typeof value === 'string' ? value.split('/').at(-1) : undefined;
}

export function parseDispositionManifest(text) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new Error('standing-delegation disposition manifest is not valid JSON');
  }
  assertExactKeys(manifest, MANIFEST_KEYS, 'manifest');
  if (manifest.version !== 1) throw new Error('manifest.version must be 1');
  assertHash(manifest.adoptionRevision, HEX_40, 'manifest.adoptionRevision');
  if (!Array.isArray(manifest.records)) throw new Error('manifest.records must be an array');
  manifest.records.forEach(validateRecord);
  const subjects = manifest.records.map(({ subject }) => subject);
  if (new Set(subjects).size !== subjects.length) {
    throw new Error('manifest records contain duplicate subjects');
  }
  const sorted = [...subjects].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(subjects) !== JSON.stringify(sorted)) {
    throw new Error('manifest records must be sorted by subject');
  }
  return manifest;
}

export function serializeDispositionManifest(manifest) {
  const records = [...manifest.records]
    .sort((left, right) => left.subject.localeCompare(right.subject))
    .map((record) => ({
      ...record,
      references: [...record.references].sort(
        (left, right) =>
          left.start - right.start || left.end - right.end || left.kind.localeCompare(right.kind),
      ),
    }));
  return `${JSON.stringify({ ...manifest, records }, null, 2)}\n`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function validateAdoptedRecord(record, snapshot) {
  validateRecord(record, 0);
  if (record.path !== snapshot.path || record.subject !== pathBasename(snapshot.path)) {
    throw new Error('adopted record subject/path does not match the snapshot');
  }
  if (record.blob !== snapshot.blob) throw new Error('adopted record Git blob does not match');
  const digests = [
    ['documentSha256', snapshot.document],
    ['evidenceLogSha256', snapshot.evidenceLog],
    ['standingVerdictSha256', snapshot.verdict],
  ];
  for (const [key, value] of digests) {
    if (record[key] !== sha256(value)) throw new Error(`adopted record ${key} does not match`);
  }
  const verdictBytes = Buffer.from(snapshot.verdict);
  for (const reference of record.references) {
    if (reference.end > verdictBytes.length) {
      throw new Error('adopted record reference bytes are out of range');
    }
    const selected = verdictBytes.subarray(reference.start, reference.end);
    if (sha256(selected) !== reference.sha256) {
      throw new Error('adopted record reference bytes do not match their hash');
    }
  }
}

export function validateDispositionManifest(manifest, adoptedSnapshots) {
  const manifestSubjects = manifest.records.map(({ subject }) => subject).sort();
  const adoptedSubjects = [...adoptedSnapshots.keys()].sort();
  if (JSON.stringify(manifestSubjects) !== JSON.stringify(adoptedSubjects)) {
    throw new Error('manifest row set does not equal the adopted frozen subject set');
  }
  const counts = Object.fromEntries([...CATEGORY_REASONS.keys()].map((category) => [category, 0]));
  for (const record of manifest.records) {
    validateAdoptedRecord(record, adoptedSnapshots.get(record.subject));
    counts[record.category] += 1;
  }
  return counts;
}

function git(root, args, allowFailure = false) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  }
  return result.status === 0 ? result.stdout : undefined;
}

export function extractEvidenceLog(document) {
  const match = /^## Evidence Log\s*$/mu.exec(document);
  if (!match) throw new Error('adopted document has no Evidence Log');
  return document.slice(match.index);
}

export function readAdoptedSnapshots(root, manifest, verdictFromDocument) {
  const baselineRelative = 'scripts/harness/standing-delegation-baseline.json';
  const baselineText = git(root, ['show', `${manifest.adoptionRevision}:${baselineRelative}`]);
  const baseline = JSON.parse(baselineText);
  if (!Array.isArray(baseline.exempt)) {
    throw new Error('adoption baseline has no exempt array');
  }
  const snapshots = new Map();
  for (const relative of baseline.exempt) {
    const adoptedPath = `.agents/spec-docs/${relative}`;
    const subject = pathBasename(adoptedPath);
    if (snapshots.has(subject)) throw new Error(`duplicate adopted subject: ${subject}`);
    const document = git(root, ['show', `${manifest.adoptionRevision}:${adoptedPath}`]);
    const verdict = verdictFromDocument(document);
    if (!verdict) throw new Error(`adopted document has no standing verdict: ${adoptedPath}`);
    snapshots.set(subject, {
      path: adoptedPath,
      blob: git(root, ['rev-parse', `${manifest.adoptionRevision}:${adoptedPath}`]).trim(),
      document,
      evidenceLog: extractEvidenceLog(document),
      verdict,
    });
  }
  return { snapshots, counts: validateDispositionManifest(manifest, snapshots) };
}

function assertAncestor(root, ancestor, descendant, owner) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`${owner} is not descended from adoptionRevision`);
}

export function validateManifestIntroduction(root, relative, bytes, adoptionRevision) {
  const additions = git(root, ['log', '--format=%H', '--diff-filter=A', '--', relative])
    .trim()
    .split('\n')
    .filter(Boolean);
  if (additions.length > 1) throw new Error('manifest has multiple introduction commits');
  if (additions.length === 0) {
    const staged = git(root, ['show', `:${relative}`], true);
    const committed = git(root, ['show', `HEAD:${relative}`], true);
    if (committed !== undefined || staged !== bytes) {
      throw new Error('manifest has no immutable introduction commit or staged introduction');
    }
    assertAncestor(root, adoptionRevision, 'HEAD', 'staged manifest introduction');
    return;
  }
  const introduction = additions[0];
  assertAncestor(root, adoptionRevision, introduction, 'manifest introduction');
  const introducedBytes = git(root, ['show', `${introduction}:${relative}`]);
  if (introducedBytes !== bytes) {
    throw new Error('manifest bytes differ from their immutable introduction');
  }
}
