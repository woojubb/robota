/**
 * MANIFEST-2664 / VERIFIER-2664 — the closed divergence manifest and its non-merge verifier.
 *
 * TC-01 drives the verifier core through a FIXTURE PORT (an in-memory reader of the five port
 * commands) so raw `-z` bytes, path ordering, dispositions, cardinality, and the closed code set are
 * asserted without a repository. TC-03 drives the DEFAULT ADAPTER against real temporary repositories
 * built under `make-temp.mjs` (`cwd` and `env` injected per case — the hermetic tier runs Vitest with
 * `--pool=threads`, where `process.chdir` is unavailable) and the CLI as a child process for the exit
 * map, stdin, the stdout drain, and `EPIPE`.
 */

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';
import { envWithoutGitVars } from '../shared.mjs';
import {
  DEFAULT_LIMITS,
  DEFAULT_MAX_BUFFER_BYTES,
  MANIFEST_CEILINGS,
  MANIFEST_DIAGNOSTIC_CODES,
  PORT_COMMANDS,
  canonicalize,
  createDefaultRunGit,
  digest,
  enumerate,
  parseManifest,
  parseRawTuples,
  sortTuples,
  treeTuples,
  validateManifest,
  verify,
} from '../integration-migration-manifest.mjs';

const MODULE = path.resolve(import.meta.dirname, '../integration-migration-manifest.mjs');
const AGREEMENT_2664_EVIDENCE = path.resolve(
  import.meta.dirname,
  '../../../.agents/evidence/migrations/BRANCH-2664-P2-agreement-2664-migration.json',
);
const ZERO = '0'.repeat(40);

// ---------------------------------------------------------------------------------------------------
// Real repositories
// ---------------------------------------------------------------------------------------------------

function fixtureEnv(extra = {}) {
  return {
    ...envWithoutGitVars(process.env),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

function git(cwd, args, { input, env = fixtureEnv() } = {}) {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    env,
    input,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function repository() {
  const root = makeTemp('robota-manifest-');
  git(root, ['init', '-q', '--object-format=sha1', '-b', 'main']);
  writeFileSync(path.join(root, 'README.md'), 'base\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'base']);
  return { root, base: git(root, ['rev-parse', 'HEAD']) };
}

function commit(root, message, files = {}) {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    if (content === null) {
      git(root, ['rm', '-q', file]);
      continue;
    }
    writeFileSync(target, content);
    git(root, ['add', file]);
  }
  git(root, ['commit', '-q', '--allow-empty', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

/**
 * The canonical two-graph fixture: a base, a replacement base two `develop` commits later, and on
 * each side one planning commit, one child commit on its own branch, and one merge of the child.
 */
function twoGraphs({ replacementPlanning = 'plan\n', extraReplacement = false } = {}) {
  const { root, base } = repository();
  const legacyBase = base;
  commit(root, 'develop 1', { 'develop-1.txt': 'd1\n' });
  const replacementBase = commit(root, 'develop 2', { 'develop-2.txt': 'd2\n' });
  // legacy graph
  git(root, ['checkout', '-q', '-b', 'legacy', legacyBase]);
  const l1 = commit(root, 'AGREEMENT prelude', { '.agents/tasks/AGREEMENT.md': 'plan\n' });
  git(root, ['checkout', '-q', '-b', 'legacy-child', l1]);
  const c1 = commit(root, 'CHILD-1', { 'child.txt': 'child\n' });
  git(root, ['checkout', '-q', 'legacy']);
  git(root, ['merge', '-q', '--no-ff', '-m', 'merge CHILD-1', 'legacy-child']);
  const legacyTip = git(root, ['rev-parse', 'HEAD']);
  // replacement graph
  git(root, ['checkout', '-q', '-b', 'replacement', replacementBase]);
  const r1 = commit(root, 'AGREEMENT prelude', {
    '.agents/tasks/AGREEMENT.md': replacementPlanning,
  });
  git(root, ['checkout', '-q', '-b', 'replacement-child', r1]);
  const c1r = commit(root, 'CHILD-1', { 'child.txt': 'child\n' });
  git(root, ['checkout', '-q', 'replacement']);
  git(root, ['merge', '-q', '--no-ff', '-m', 'merge CHILD-1', 'replacement-child']);
  const mergeR = git(root, ['rev-parse', 'HEAD']);
  const r2 = extraReplacement ? commit(root, 'ledger', { 'ledger.jsonl': '{}\n' }) : null;
  const replacementTip = git(root, ['rev-parse', 'HEAD']);
  const mergeL = legacyTip;
  return {
    root,
    legacyBase,
    replacementBase,
    legacyTip,
    replacementTip,
    l1,
    c1,
    mergeL,
    r1,
    c1r,
    mergeR,
    r2,
  };
}

/** Derive the manifest for a two-graph fixture through the producer primitives. */
function manifestFor(g, runGit, { dispositions = {} } = {}) {
  const tuplesOf = (parent, oid) => {
    const result = treeTuples(runGit, parent, oid);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    return result.tuples;
  };
  const records = [];
  const planning = dispositions.planning ?? 'equal';
  if (planning === 'equal') records.push({ kind: 'equal', legacy: g.l1, replacement: g.r1 });
  else {
    records.push({
      kind: 'diverged',
      legacy: g.l1,
      replacement: g.r1,
      legacyTuples: tuplesOf(g.legacyBase, g.l1),
      replacementTuples: tuplesOf(g.replacementBase, g.r1),
      patchIdEqual: dispositions.patchIdEqual ?? false,
      reason: 'the prelude was corrected',
      evidence: 'https://example.invalid/review/1',
    });
  }
  records.push({ kind: 'equal', legacy: g.c1, replacement: g.c1r });
  records.push({ kind: 'merge', graph: 'legacy', oid: g.mergeL, parents: [g.l1, g.c1] });
  records.push({ kind: 'merge', graph: 'replacement', oid: g.mergeR, parents: [g.r1, g.c1r] });
  const replacementSegments = { predecessor: g.replacementBase, commits: [g.r1] };
  if (g.r2) {
    records.push({
      kind: 'replacement-only',
      replacement: g.r2,
      tuples: tuplesOf(g.mergeR, g.r2),
      reason: 'a ledger append the legacy history never had',
      evidence: 'https://example.invalid/review/2',
    });
  }
  return {
    schemaVersion: 1,
    objectFormat: 'sha1',
    agreementId: 'AGREEMENT-2664',
    issue: 2664,
    legacyBase: g.legacyBase,
    replacementBase: g.replacementBase,
    legacyTip: g.legacyTip,
    replacementTip: g.replacementTip,
    segments: [
      {
        id: 'PLANNING',
        legacy: { predecessor: g.legacyBase, commits: [g.l1] },
        replacement: replacementSegments,
      },
      {
        id: 'CHILD-1',
        legacy: { predecessor: g.l1, commits: [g.c1] },
        replacement: { predecessor: g.r1, commits: [g.c1r] },
      },
      ...(g.r2
        ? [
            {
              id: 'LEDGER',
              legacy: { predecessor: g.mergeL, commits: [] },
              replacement: { predecessor: g.mergeR, commits: [g.r2] },
            },
          ]
        : []),
    ],
    records,
  };
}

function codesOf(result) {
  return (result.findings ?? result.diagnostics ?? []).map((item) => item.code);
}

// ---------------------------------------------------------------------------------------------------
// The fixture port
// ---------------------------------------------------------------------------------------------------

function ok(stdout) {
  return {
    status: 0,
    signal: null,
    error: undefined,
    stdout: Buffer.from(stdout),
    stderr: Buffer.alloc(0),
  };
}

function status(code, stderr = '') {
  return {
    status: code,
    signal: null,
    error: undefined,
    stdout: Buffer.alloc(0),
    stderr: Buffer.from(stderr),
  };
}

/**
 * A reader of exactly the five port commands over an in-memory description. `ancestors` holds
 * "a b" pairs for which a is an ancestor of b; `ranges` maps "base..tip" to `[oid, ...parents]`
 * rows; `deltas` maps "parent commit" to raw `-z` bytes; `patchIds` maps "parent commit" to an id
 * or '' for an empty patch. Every invocation is counted.
 */
function fixturePort({
  objectFormat = 'sha1',
  ancestors = new Set(),
  ranges = {},
  deltas = {},
  patchIds = {},
  overrides = {},
} = {}) {
  const calls = [];
  const port = (command, args, options) => {
    calls.push({ command, args, options });
    if (!PORT_COMMANDS.includes(command)) throw new Error(`unexpected command ${command}`);
    const override = overrides[command];
    if (override) return override(args, options);
    if (command === 'rev-parse') return ok(`${objectFormat}\n`);
    if (command === 'merge-base') {
      const key = `${args[1]} ${args[2]}`;
      if (ancestors.has(key)) return ok('');
      return status(1);
    }
    if (command === 'rev-list') {
      const rows = ranges[args[1]];
      if (!rows) return status(128, `fatal: bad revision '${args[1]}'`);
      return ok(rows.map((row) => row.join(' ')).join('\n') + (rows.length ? '\n' : ''));
    }
    if (command === 'diff-tree') {
      const key = `${args[5]} ${args[6]}`;
      if (!(key in deltas)) return status(128, `fatal: bad object ${key}`);
      return ok(deltas[key]);
    }
    const key = `${args[0]} ${args[1]}`;
    if (!(key in patchIds)) return status(128, `fatal: bad object ${key}`);
    return ok(patchIds[key] === '' ? '' : `${patchIds[key]} ${args[1]}\n`);
  };
  port.calls = calls;
  return port;
}

function oid(seed) {
  return digest(seed).slice(0, 40);
}

/** Raw `-z` bytes for one entry. */
function raw(status, oldMode, newMode, oldOid, newOid, pathBytes) {
  return Buffer.concat([
    Buffer.from(`:${oldMode} ${newMode} ${oldOid} ${newOid} ${status}\0`),
    Buffer.from(pathBytes),
    Buffer.from([0]),
  ]);
}

function tuple(status, oldMode, newMode, oldOid, newOid, pathBytes) {
  return {
    pathBytesBase64: Buffer.from(pathBytes).toString('base64'),
    status,
    oldMode,
    newMode,
    oldOid,
    newOid,
  };
}

/** A minimal in-memory two-graph world mirroring `twoGraphs`, with derived manifest. */
function world({ planning = 'equal' } = {}) {
  const ids = {
    legacyBase: oid('legacyBase'),
    replacementBase: oid('replacementBase'),
    l1: oid('l1'),
    c1: oid('c1'),
    mergeL: oid('mergeL'),
    r1: oid('r1'),
    c1r: oid('c1r'),
    mergeR: oid('mergeR'),
    blobPlan: oid('blob plan'),
    blobPlanR: oid('blob plan r'),
    blobChild: oid('blob child'),
  };
  const planL = raw('A', '000000', '100644', ZERO, ids.blobPlan, '.agents/tasks/AGREEMENT.md');
  const planR = raw(
    'A',
    '000000',
    '100644',
    ZERO,
    planning === 'equal' ? ids.blobPlan : ids.blobPlanR,
    '.agents/tasks/AGREEMENT.md',
  );
  const child = raw('A', '000000', '100644', ZERO, ids.blobChild, 'child.txt');
  const port = fixturePort({
    ancestors: new Set([
      `${ids.legacyBase} ${ids.replacementBase}`,
      `${ids.legacyBase} ${ids.mergeL}`,
      `${ids.replacementBase} ${ids.mergeR}`,
    ]),
    ranges: {
      [`${ids.legacyBase}..${ids.mergeL}`]: [
        [ids.mergeL, ids.l1, ids.c1],
        [ids.c1, ids.l1],
        [ids.l1, ids.legacyBase],
      ],
      [`${ids.replacementBase}..${ids.mergeR}`]: [
        [ids.mergeR, ids.r1, ids.c1r],
        [ids.c1r, ids.r1],
        [ids.r1, ids.replacementBase],
      ],
    },
    deltas: {
      [`${ids.legacyBase} ${ids.l1}`]: planL,
      [`${ids.replacementBase} ${ids.r1}`]: planR,
      [`${ids.l1} ${ids.c1}`]: child,
      [`${ids.r1} ${ids.c1r}`]: child,
    },
    patchIds: {
      [`${ids.legacyBase} ${ids.l1}`]: oid('patch plan L'),
      [`${ids.replacementBase} ${ids.r1}`]:
        planning === 'equal' ? oid('patch plan L') : oid('patch plan R'),
      [`${ids.l1} ${ids.c1}`]: oid('patch child'),
      [`${ids.r1} ${ids.c1r}`]: oid('patch child'),
    },
  });
  const records = [
    planning === 'equal'
      ? { kind: 'equal', legacy: ids.l1, replacement: ids.r1 }
      : {
          kind: 'diverged',
          legacy: ids.l1,
          replacement: ids.r1,
          legacyTuples: parseRawTuples(planL).tuples,
          replacementTuples: parseRawTuples(planR).tuples,
          patchIdEqual: false,
          reason: 'prelude corrected',
          evidence: 'https://example.invalid/r/1',
        },
    { kind: 'equal', legacy: ids.c1, replacement: ids.c1r },
    { kind: 'merge', graph: 'legacy', oid: ids.mergeL, parents: [ids.l1, ids.c1] },
    { kind: 'merge', graph: 'replacement', oid: ids.mergeR, parents: [ids.r1, ids.c1r] },
  ];
  const manifest = {
    schemaVersion: 1,
    objectFormat: 'sha1',
    agreementId: 'AGREEMENT-2664',
    issue: 2664,
    legacyBase: ids.legacyBase,
    replacementBase: ids.replacementBase,
    legacyTip: ids.mergeL,
    replacementTip: ids.mergeR,
    segments: [
      {
        id: 'PLANNING',
        legacy: { predecessor: ids.legacyBase, commits: [ids.l1] },
        replacement: { predecessor: ids.replacementBase, commits: [ids.r1] },
      },
      {
        id: 'CHILD-1',
        legacy: { predecessor: ids.l1, commits: [ids.c1] },
        replacement: { predecessor: ids.r1, commits: [ids.c1r] },
      },
    ],
    records,
  };
  return { ids, port, manifest, planL, planR, child };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// ---------------------------------------------------------------------------------------------------
// TC-01 — schema, canonical bytes, tuples, dispositions, cardinality, closed codes (fixture port)
// ---------------------------------------------------------------------------------------------------

describe('MANIFEST_DIAGNOSTIC_CODES is exactly the v1 set', () => {
  it('equals the listed vocabulary, by equality not membership', () => {
    expect(MANIFEST_DIAGNOSTIC_CODES).toEqual({
      parse: [
        'MALFORMED_JSON',
        'NONCANONICAL_BYTES',
        'UNKNOWN_FIELD',
        'MISSING_FIELD',
        'INVALID_FIELD',
        'UNSUPPORTED_SCHEMA_VERSION',
        'UNSUPPORTED_OBJECT_FORMAT',
        'DUPLICATE_RECORD',
        'SIZE_LIMIT',
        'SEGMENT_LIMIT',
        'RECORD_LIMIT',
        'TUPLE_LIMIT',
      ],
      refuted: [
        'BASES_NOT_ANCESTRAL',
        'TIP_NOT_DESCENDANT',
        'UNRECORDED_COMMIT',
        'INVENTED_RECORD',
        'PARENT_CARDINALITY',
        'SEGMENT_MEMBERSHIP',
        'TUPLES_MISMATCH',
        'EQUAL_NOT_EQUAL',
        'PATCH_ID_FLAG_MISMATCH',
      ],
      aborted: [
        'REPOSITORY_OBJECT_FORMAT',
        'UNKNOWN_OID',
        'INVALID_LIMITS',
        'BUDGET_EXHAUSTED',
        'PORT_TIMEOUT',
        'PORT_OUTPUT_LIMIT',
        'GIT_NOT_FOUND',
        'CWD_NOT_FOUND',
        'PORT_FAILURE',
        'USAGE',
        'STDOUT_EPIPE',
        'UNEXPECTED_ERROR',
      ],
    });
    expect(Object.isFrozen(MANIFEST_DIAGNOSTIC_CODES)).toBe(true);
    expect(DEFAULT_LIMITS).toEqual({ timeoutMs: 600_000, commandBudget: 32_768 });
    expect(DEFAULT_MAX_BUFFER_BYTES).toBe(16 * 1024 * 1024);
    expect(MANIFEST_CEILINGS).toEqual({
      bytes: 8 * 1024 * 1024,
      segments: 64,
      records: 4096,
      tuples: 100_000,
    });
  });
});

describe('canonical bytes and digest', () => {
  it('sorts keys, drops whitespace, ends with exactly one newline, and round-trips through strict parse', () => {
    const { manifest } = world();
    const bytes = Buffer.from(canonicalize(manifest));
    expect(bytes.subarray(-1)).toEqual(Buffer.from('\n'));
    expect(bytes.toString('utf8')).not.toMatch(/\n./);
    expect(bytes.toString('utf8').startsWith('{"agreementId":"AGREEMENT-2664","issue":2664,')).toBe(
      true,
    );
    const parsed = parseManifest(bytes);
    expect(parsed.ok).toBe(true);
    expect(Buffer.from(canonicalize(parsed.manifest)).equals(bytes)).toBe(true);
    expect(digest(bytes)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('one known byte string maps to one stated digest', () => {
    // sha256 of the two bytes `{}` + newline, stated as a constant so the algorithm and the exact
    // input bytes are both pinned (`printf '{}\n' | shasum -a 256`).
    expect(digest(Buffer.from('{}\n'))).toBe(
      'ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356',
    );
  });
});

describe('parseManifest', () => {
  it('binds the canonical AGREEMENT-2664 migration evidence', () => {
    const bytes = readFileSync(AGREEMENT_2664_EVIDENCE);
    const parsed = parseManifest(bytes);

    expect(parsed.ok).toBe(true);
    expect(parsed.manifest).toMatchObject({
      agreementId: 'AGREEMENT-2664',
      issue: 2664,
      legacyTip: '4214cb540a54037410388a3a8107e474c224c86f',
      replacementTip: '720eb5e841ba7a5361ac667b9658e034212bb58e',
    });
    expect(parsed.manifest.records).toHaveLength(78);
    expect(parsed.manifest.segments).toHaveLength(8);
    expect(digest(bytes)).toBe('1dfc77165cfdb602c12a34a1b61e15e7ea22c03163695ce420efb5a32656f2c8');
  });

  it('refuses noncanonical bytes under strict and accepts them under strict: false', () => {
    const { manifest } = world();
    const pretty = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    expect(codesOf(parseManifest(pretty))).toEqual(['NONCANONICAL_BYTES']);
    const lenient = parseManifest(pretty, { strict: false });
    expect(lenient.ok).toBe(true);
    expect(
      Buffer.from(canonicalize(lenient.manifest)).equals(Buffer.from(canonicalize(manifest))),
    ).toBe(true);
  });

  it('reports each malformation by its closed code', () => {
    const { manifest } = world();
    const bytes = (value) => Buffer.from(canonicalize(value));
    expect(codesOf(parseManifest(Buffer.from('{not json')))).toEqual(['MALFORMED_JSON']);
    expect(codesOf(parseManifest(bytes({ ...manifest, extra: 1 })))).toContain('UNKNOWN_FIELD');
    const missing = clone(manifest);
    delete missing.issue;
    expect(codesOf(parseManifest(bytes(missing)))).toContain('MISSING_FIELD');
    expect(codesOf(parseManifest(bytes({ ...manifest, schemaVersion: 2 })))).toContain(
      'UNSUPPORTED_SCHEMA_VERSION',
    );
    expect(codesOf(parseManifest(bytes({ ...manifest, objectFormat: 'sha256' })))).toContain(
      'UNSUPPORTED_OBJECT_FORMAT',
    );
    expect(codesOf(parseManifest(bytes({ ...manifest, legacyTip: 'abc' })))).toContain(
      'INVALID_FIELD',
    );
    const duplicate = clone(manifest);
    duplicate.records.push({
      kind: 'legacy-only',
      legacy: manifest.records[0].legacy,
      tuples: [],
      reason: 'x',
      evidence: 'y',
    });
    expect(codesOf(parseManifest(bytes(duplicate)))).toContain('DUPLICATE_RECORD');
    const unicode = clone(manifest);
    unicode.agreementId = 'AGREEMENT-2664-é';
    expect(() => canonicalize(unicode)).toThrow(/printable ASCII/);
    expect(codesOf(parseManifest(Buffer.from(`${JSON.stringify(unicode)}\n`)))).toContain(
      'INVALID_FIELD',
    );
    // A `kind` that names an inherited property is not a record kind: the guard must answer with
    // the closed code, not reach `Object.prototype` and throw.
    for (const inherited of ['__proto__', 'toString', 'hasOwnProperty']) {
      const proto = clone(manifest);
      proto.records[0] = { kind: inherited };
      expect(() => validateManifest(proto)).not.toThrow();
      expect(codesOf(parseManifest(bytes(proto)))).toContain('INVALID_FIELD');
    }
  });

  it('accepts each ceiling at its boundary and refuses it at boundary plus one', () => {
    const { manifest } = world();
    const bytes = (value) => Buffer.from(canonicalize(value));
    const segment = (i) => ({
      id: `S${i}`,
      legacy: { predecessor: ZERO, commits: [] },
      replacement: { predecessor: ZERO, commits: [] },
    });
    const at = clone(manifest);
    at.segments = Array.from({ length: MANIFEST_CEILINGS.segments }, (_, i) => segment(i));
    expect(parseManifest(bytes(at)).ok).toBe(true);
    at.segments.push(segment(MANIFEST_CEILINGS.segments));
    expect(codesOf(parseManifest(bytes(at)))).toContain('SEGMENT_LIMIT');

    const records = clone(manifest);
    const filler = (i) => ({
      kind: 'legacy-only',
      legacy: oid(`filler ${i}`),
      tuples: [],
      reason: 'r',
      evidence: 'e',
    });
    while (records.records.length < MANIFEST_CEILINGS.records)
      records.records.push(filler(records.records.length));
    expect(parseManifest(bytes(records)).ok).toBe(true);
    records.records.push(filler('over'));
    expect(codesOf(parseManifest(bytes(records)))).toContain('RECORD_LIMIT');

    // 100,000 tuples serialise past the 8 MiB byte ceiling, so the tuple ceiling is reached through
    // the schema check `verify` re-runs on an object, not through canonical bytes.
    const tuples = clone(manifest);
    const one = tuple('A', '000000', '100644', ZERO, oid('t'), 'p');
    const many = (n) =>
      Array.from({ length: n }, (_, i) => ({
        ...one,
        pathBytesBase64: Buffer.from(`p${String(i).padStart(6, '0')}`).toString('base64'),
      }));
    tuples.records.push({
      kind: 'legacy-only',
      legacy: oid('big'),
      tuples: many(MANIFEST_CEILINGS.tuples),
      reason: 'r',
      evidence: 'e',
    });
    expect(validateManifest(tuples)).toEqual([]);
    tuples.records[tuples.records.length - 1].tuples = many(MANIFEST_CEILINGS.tuples + 1);
    expect(validateManifest(tuples).map((d) => d.code)).toEqual(['TUPLE_LIMIT']);
    expect(codesOf(verify(tuples, { runGit: () => ok('') }))).toEqual(['TUPLE_LIMIT']);

    const size = clone(manifest);
    size.records.push({
      kind: 'legacy-only',
      legacy: oid('pad'),
      tuples: [],
      reason: 'r',
      evidence: 'e',
    });
    const withReason = (reason) => {
      size.records[size.records.length - 1].reason = reason;
      return bytes(size);
    };
    const baseline = withReason('x').length;
    const exact = withReason('x'.repeat(MANIFEST_CEILINGS.bytes - baseline + 1));
    expect(exact.length).toBe(MANIFEST_CEILINGS.bytes);
    expect(parseManifest(exact).ok).toBe(true);
    const over = withReason('x'.repeat(MANIFEST_CEILINGS.bytes - baseline + 2));
    expect(over.length).toBe(MANIFEST_CEILINGS.bytes + 1);
    expect(codesOf(parseManifest(over))).toEqual(['SIZE_LIMIT']);
  });
});

describe('raw -z tuples', () => {
  it('round-trips non-UTF-8, newline, tab, and nested paths byte-for-byte and orders by decoded bytes', () => {
    const paths = [
      Buffer.from('dir/z.txt'),
      Buffer.from('dir/a\nb.txt'),
      Buffer.from('dir/a\tb.txt'),
      Buffer.from([0x64, 0x69, 0x72, 0x2f, 0xff, 0xfe]),
      Buffer.from([0x64, 0x69, 0x72, 0x2f, 0xfe, 0xff]),
      Buffer.from('dir'),
    ];
    const bytes = Buffer.concat(
      paths.map((p, i) => raw('A', '000000', '100644', ZERO, oid(`b${i}`), p)),
    );
    const parsed = parseRawTuples(bytes);
    expect(parsed.ok).toBe(true);
    const decoded = parsed.tuples.map((t) => Buffer.from(t.pathBytesBase64, 'base64'));
    for (let i = 1; i < decoded.length; i += 1)
      expect(Buffer.compare(decoded[i - 1], decoded[i])).toBeLessThan(0);
    expect(decoded.map((b) => b.toString('hex')).sort()).toEqual(
      paths.map((b) => b.toString('hex')).sort(),
    );
    expect(decoded.some((b) => b.equals(paths[3]))).toBe(true);
    expect(decoded.some((b) => b.equals(paths[4]))).toBe(true);
    expect(sortTuples([...parsed.tuples].reverse())).toEqual(parsed.tuples);
  });

  it('refuses a rename entry, because --no-renames is pinned and R never appears', () => {
    const bytes = Buffer.concat([
      Buffer.from(`:100644 100644 ${oid('a')} ${oid('a')} R100\0`),
      Buffer.from('a\0b\0'),
    ]);
    expect(parseRawTuples(bytes).ok).toBe(false);
  });
});

describe('verify through the fixture port', () => {
  it('passes an equivalent replay of equal and structural merge records', () => {
    const { port, manifest } = world();
    expect(verify(manifest, { runGit: port })).toEqual({ ok: true });
    expect(port.calls.map((c) => c.command)).toEqual([
      'rev-parse',
      'merge-base',
      'merge-base',
      'merge-base',
      'rev-list',
      'rev-list',
      'diff-tree',
      'diff-tree',
      'diff-tree',
      'diff-tree',
    ]);
  });

  it('accepts a diverged record with its tuples and flag, and refutes a wrong flag or altered tuples', () => {
    const { port, manifest } = world({ planning: 'diverged' });
    expect(verify(manifest, { runGit: port })).toEqual({ ok: true });
    const flag = clone(manifest);
    flag.records[0].patchIdEqual = true;
    expect(codesOf(verify(flag, { runGit: port }))).toEqual(['PATCH_ID_FLAG_MISMATCH']);
    const altered = clone(manifest);
    altered.records[0].replacementTuples[0].newOid = oid('tampered');
    expect(codesOf(verify(altered, { runGit: port }))).toEqual(['TUPLES_MISMATCH']);
  });

  it('refutes an equal record whose sides recompute differently', () => {
    const { port, manifest } = world({ planning: 'diverged' });
    const claimed = clone(manifest);
    claimed.records[0] = {
      kind: 'equal',
      legacy: manifest.records[0].legacy,
      replacement: manifest.records[0].replacement,
    };
    expect(codesOf(verify(claimed, { runGit: port }))).toEqual(['EQUAL_NOT_EQUAL']);
  });

  it('refutes omitted, invented, misparented, and misordered records by name', () => {
    const { ids, port, manifest } = world();
    const omitted = clone(manifest);
    omitted.records.splice(1, 1);
    omitted.segments[1].legacy.commits = [];
    omitted.segments[1].replacement.commits = [];
    expect(codesOf(verify(omitted, { runGit: port }))).toEqual(
      expect.arrayContaining(['UNRECORDED_COMMIT', 'SEGMENT_MEMBERSHIP']),
    );
    const invented = clone(manifest);
    invented.records.push({
      kind: 'legacy-only',
      legacy: oid('nowhere'),
      tuples: [],
      reason: 'r',
      evidence: 'e',
    });
    expect(codesOf(verify(invented, { runGit: port }))).toEqual(['INVENTED_RECORD']);
    const swapped = clone(manifest);
    swapped.records[2].parents = [ids.c1, ids.l1];
    expect(codesOf(verify(swapped, { runGit: port }))).toEqual(['PARENT_CARDINALITY']);
    const nonMergeForMerge = clone(manifest);
    nonMergeForMerge.records[2] = {
      kind: 'legacy-only',
      legacy: ids.mergeL,
      tuples: [],
      reason: 'r',
      evidence: 'e',
    };
    expect(codesOf(verify(nonMergeForMerge, { runGit: port }))).toEqual(['PARENT_CARDINALITY']);
    const reordered = clone(manifest);
    reordered.segments[0].legacy.commits = [ids.c1];
    reordered.segments[1].legacy.commits = [ids.l1];
    expect(codesOf(verify(reordered, { runGit: port }))).toEqual([
      'SEGMENT_MEMBERSHIP',
      'SEGMENT_MEMBERSHIP',
    ]);
  });

  it('refutes ancestry by name before enumerating', () => {
    const { ids, port, manifest } = world();
    const bases = clone(manifest);
    bases.legacyBase = ids.replacementBase;
    bases.replacementBase = ids.legacyBase;
    const result = verify(bases, { runGit: port });
    expect(result.outcome).toBe('refuted');
    expect(codesOf(result)).toEqual(expect.arrayContaining(['BASES_NOT_ANCESTRAL']));
    expect(port.calls.some((c) => c.command === 'rev-list')).toBe(false);
    const tip = clone(manifest);
    tip.legacyTip = ids.mergeR;
    const tipResult = verify(tip, {
      runGit: fixturePort({
        ancestors: new Set([
          `${ids.legacyBase} ${ids.replacementBase}`,
          `${ids.replacementBase} ${ids.mergeR}`,
        ]),
      }),
    });
    expect(codesOf(tipResult)).toEqual(['TIP_NOT_DESCENDANT']);
  });

  it('treats a commit present in both enumerations as one equal record costing one diff-tree', () => {
    const { ids, manifest } = world();
    const shared = oid('shared');
    const delta = raw('M', '100644', '100644', oid('x'), oid('y'), 'README.md');
    const port = fixturePort({
      ancestors: new Set([
        `${ids.legacyBase} ${ids.replacementBase}`,
        `${ids.legacyBase} ${shared}`,
        `${ids.replacementBase} ${shared}`,
      ]),
      ranges: {
        [`${ids.legacyBase}..${shared}`]: [[shared, ids.legacyBase]],
        [`${ids.replacementBase}..${shared}`]: [[shared, ids.replacementBase]],
      },
      deltas: {
        [`${ids.legacyBase} ${shared}`]: delta,
        [`${ids.replacementBase} ${shared}`]: delta,
      },
    });
    const both = {
      ...clone(manifest),
      legacyTip: shared,
      replacementTip: shared,
      segments: [
        {
          id: 'SYNC',
          legacy: { predecessor: ids.legacyBase, commits: [shared] },
          replacement: { predecessor: ids.replacementBase, commits: [shared] },
        },
      ],
      records: [{ kind: 'equal', legacy: shared, replacement: shared }],
    };
    // The replacement side's parent differs, so the recomputation is one diff-tree per side here;
    // the same-OID short cut applies when both graphs give the commit the same parent.
    expect(verify(both, { runGit: port })).toEqual({ ok: true });
  });

  it('aborts with UNKNOWN_OID, REPOSITORY_OBJECT_FORMAT, and named port failures, never a disposition', () => {
    const { manifest } = world();
    const unknown = verify(manifest, {
      runGit: fixturePort({
        ancestors: new Set(),
        overrides: { 'merge-base': () => status(128, 'fatal: not a valid object name') },
      }),
    });
    expect(unknown).toMatchObject({ ok: false, outcome: 'aborted' });
    expect(codesOf(unknown)).toEqual(['UNKNOWN_OID']);
    expect(codesOf(verify(manifest, { runGit: fixturePort({ objectFormat: 'sha256' }) }))).toEqual([
      'REPOSITORY_OBJECT_FORMAT',
    ]);
    const timeout = {
      status: null,
      signal: null,
      error: { code: 'ETIMEDOUT' },
      stdout: undefined,
      stderr: undefined,
    };
    expect(
      codesOf(
        verify(manifest, { runGit: fixturePort({ overrides: { 'rev-parse': () => timeout } }) }),
      ),
    ).toEqual(['PORT_TIMEOUT']);
    expect(
      codesOf(
        verify(manifest, {
          runGit: fixturePort({ overrides: { 'rev-parse': () => status(2, 'boom') } }),
        }),
      ),
    ).toEqual(['PORT_FAILURE']);
    const { port } = world();
    const revList = verify(manifest, {
      runGit: fixturePort({
        ancestors: new Set([...port.calls.map(() => '')]),
        overrides: {
          'merge-base': () => ok(''),
          'rev-list': () => status(128, 'fatal: bad revision'),
        },
      }),
    });
    expect(codesOf(revList)).toEqual(['UNKNOWN_OID']);
    const throwing = verify(manifest, {
      runGit: () => {
        throw new Error('port exploded');
      },
    });
    expect(throwing).toMatchObject({ ok: false, outcome: 'aborted' });
    expect(codesOf(throwing)).toEqual(['UNEXPECTED_ERROR']);
    expect(() => verify(manifest, {})).toThrow(TypeError);
  });

  it('enforces the budget at its boundaries through an injected clock and limits', () => {
    const { manifest } = world();
    const calls = world().port.calls.length; // 0 before any run
    expect(calls).toBe(0);
    const full = world();
    verify(full.manifest, { runGit: full.port });
    const needed = full.port.calls.length;
    expect(
      verify(manifest, {
        runGit: world().port,
        limits: { timeoutMs: 1000, commandBudget: needed },
      }),
    ).toEqual({ ok: true });
    const short = verify(manifest, {
      runGit: world().port,
      limits: { timeoutMs: 1000, commandBudget: needed - 1 },
    });
    expect(codesOf(short)).toEqual(['BUDGET_EXHAUSTED']);
    let tick = 0;
    const stepping = (last) => () => (tick++ === 0 ? 0 : last);
    expect(
      verify(manifest, {
        runGit: world().port,
        now: stepping(999),
        limits: { timeoutMs: 1000, commandBudget: needed },
      }),
    ).toEqual({ ok: true });
    tick = 0;
    const late = verify(manifest, {
      runGit: world().port,
      now: stepping(1000),
      limits: { timeoutMs: 1000, commandBudget: needed },
    });
    expect(codesOf(late)).toEqual(['BUDGET_EXHAUSTED']);
    expect(
      codesOf(
        verify(manifest, { runGit: world().port, limits: { timeoutMs: 0.5, commandBudget: 1 } }),
      ),
    ).toEqual(['INVALID_LIMITS']);
    const seen = world();
    verify(seen.manifest, {
      runGit: seen.port,
      limits: { timeoutMs: 600_000, commandBudget: needed },
    });
    expect(seen.port.calls.every((c) => c.options.timeoutMs === 10_000)).toBe(true);
  });

  it('aborts, not refutes, on a schema failure inside verify and carries no findings', () => {
    const { port, manifest } = world();
    const broken = { ...manifest, schemaVersion: 2 };
    const result = verify(broken, { runGit: port });
    expect(result).toMatchObject({ ok: false, outcome: 'aborted' });
    expect(result.findings).toBeUndefined();
    expect(codesOf(result)).toEqual(['UNSUPPORTED_SCHEMA_VERSION']);
    expect(port.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// TC-03 — the default adapter against real repositories, and the CLI as a child
// ---------------------------------------------------------------------------------------------------

describe('default adapter against real repositories', () => {
  it('verifies an equivalent replay and an extra replacement-only ledger commit', () => {
    const g = twoGraphs({ extraReplacement: true });
    const runGit = createDefaultRunGit({ cwd: g.root, env: fixtureEnv() });
    const manifest = manifestFor(g, runGit);
    expect(parseManifest(canonicalize(manifest)).ok).toBe(true);
    expect(verify(manifest, { runGit })).toEqual({ ok: true });
    const listed = enumerate(runGit, g.legacyBase, g.legacyTip);
    expect(listed.ok).toBe(true);
    expect(listed.commits.map((c) => c.oid).sort()).toEqual([g.l1, g.c1, g.mergeL].sort());
    expect(listed.commits.find((c) => c.oid === g.mergeL).parents).toEqual([g.l1, g.c1]);
  });

  it('names a diverged prelude by tuples and patch-id flag, and refutes the flag when wrong', () => {
    const g = twoGraphs({ replacementPlanning: 'plan corrected\n' });
    const runGit = createDefaultRunGit({ cwd: g.root, env: fixtureEnv() });
    const equalClaim = manifestFor(g, runGit);
    expect(codesOf(verify(equalClaim, { runGit }))).toEqual(['EQUAL_NOT_EQUAL']);
    const diverged = manifestFor(g, runGit, {
      dispositions: { planning: 'diverged', patchIdEqual: false },
    });
    expect(verify(diverged, { runGit })).toEqual({ ok: true });
    const wrongFlag = manifestFor(g, runGit, {
      dispositions: { planning: 'diverged', patchIdEqual: true },
    });
    expect(codesOf(verify(wrongFlag, { runGit }))).toEqual(['PATCH_ID_FLAG_MISMATCH']);
  });

  it('observes mode-only, type, add/delete, rename-as-two-tuples, empty-patch, and one-byte changes', () => {
    const { root, base } = repository();
    const runGit = createDefaultRunGit({ cwd: root, env: fixtureEnv() });
    const tuplesOf = (parent, oid) => treeTuples(runGit, parent, oid).tuples;

    chmodSync(path.join(root, 'README.md'), 0o755);
    git(root, ['add', 'README.md']);
    const mode = commit(root, 'chmod');
    expect(tuplesOf(base, mode)).toMatchObject([
      { status: 'M', oldMode: '100644', newMode: '100755' },
    ]);
    const modeId = runGit('patch-id', [base, mode]).stdout.toString();
    expect(modeId).not.toBe('');

    git(root, ['rm', '-q', 'README.md']);
    symlinkSync('target', path.join(root, 'README.md'));
    git(root, ['add', 'README.md']);
    const type = commit(root, 'type');
    expect(tuplesOf(mode, type)).toMatchObject([
      { status: 'T', oldMode: '100755', newMode: '120000' },
    ]);

    const added = commit(root, 'add', { 'new.txt': 'n\n' });
    expect(tuplesOf(type, added)).toMatchObject([{ status: 'A', oldMode: '000000', oldOid: ZERO }]);
    const deleted = commit(root, 'delete', { 'new.txt': null });
    expect(tuplesOf(added, deleted)).toMatchObject([
      { status: 'D', newMode: '000000', newOid: ZERO },
    ]);

    const before = commit(root, 'file', { 'from.txt': 'same content\n' });
    git(root, ['mv', 'from.txt', 'to.txt']);
    const renamed = commit(root, 'rename');
    const renameTuples = tuplesOf(before, renamed);
    expect(
      renameTuples.map((t) => [t.status, Buffer.from(t.pathBytesBase64, 'base64').toString()]),
    ).toEqual([
      ['D', 'from.txt'],
      ['A', 'to.txt'],
    ]);

    const empty = commit(root, 'empty');
    expect(tuplesOf(renamed, empty)).toEqual([]);
    expect(runGit('patch-id', [renamed, empty]).stdout.length).toBe(0);

    const one = commit(root, 'one byte', { 'to.txt': 'same content!\n' });
    expect(tuplesOf(empty, one)).toMatchObject([{ status: 'M' }]);
  });

  it('keeps a non-UTF-8 path with a newline as raw bytes through the adapter', () => {
    const { root, base } = repository();
    const runGit = createDefaultRunGit({ cwd: root, env: fixtureEnv() });
    const blob = git(root, ['hash-object', '-w', '--stdin'], { input: 'bytes\n' });
    const weird = Buffer.concat([
      Buffer.from('dir/'),
      Buffer.from([0xff, 0x0a, 0xfe]),
      Buffer.from('.txt'),
    ]);
    git(root, ['update-index', '--add', '-z', '--index-info'], {
      input: Buffer.concat([Buffer.from(`100644 ${blob}\t`), weird, Buffer.from([0])]),
    });
    const tree = git(root, ['write-tree']);
    const oidWeird = git(root, ['commit-tree', tree, '-p', base, '-m', 'weird path']);
    const raw = runGit('diff-tree', [
      '--no-commit-id',
      '--raw',
      '-r',
      '-z',
      '--no-renames',
      base,
      oidWeird,
    ]);
    expect(Buffer.isBuffer(raw.stdout)).toBe(true);
    const tuples = treeTuples(runGit, base, oidWeird).tuples;
    expect(tuples).toHaveLength(1);
    expect(tuples[0].pathBytesBase64).toBe(weird.toString('base64'));
  });

  it('is unchanged under hostile gitattributes and configuration, with a positive control', () => {
    const g = twoGraphs({ replacementPlanning: 'plan corrected\n' });
    const runGit = createDefaultRunGit({ cwd: g.root, env: fixtureEnv() });
    const clean = manifestFor(g, runGit, {
      dispositions: { planning: 'diverged', patchIdEqual: false },
    });
    const cleanId = runGit('patch-id', [g.legacyBase, g.l1]).stdout.toString();
    // Three attribute sources the adapter's configuration isolation cannot reach.
    writeFileSync(path.join(g.root, '.git/info/attributes'), '* -diff\n');
    writeFileSync(path.join(g.root, '.gitattributes'), '* -diff\n');
    const attrs = path.join(g.root, 'attrs');
    writeFileSync(attrs, '* -diff\n');
    git(g.root, ['config', '--local', 'core.attributesFile', attrs]);
    const home = makeTemp('robota-manifest-home-');
    writeFileSync(
      path.join(home, '.gitconfig'),
      `[core]\n\tattributesFile = ${attrs}\n\tabbrev = 12\n\tquotePath = false\n[diff]\n\trenames = true\n`,
    );
    const hostile = createDefaultRunGit({
      cwd: g.root,
      env: fixtureEnv({ HOME: home, GIT_CONFIG_GLOBAL: undefined }),
    });
    expect(hostile('patch-id', [g.legacyBase, g.l1]).stdout.toString()).toBe(cleanId);
    expect(verify(clean, { runGit: hostile })).toEqual({ ok: true });
    expect(treeTuples(hostile, g.legacyBase, g.l1)).toEqual(treeTuples(runGit, g.legacyBase, g.l1));
    // Positive control: the same pair without --text, under those sources, moves.
    const control = spawnSync('git', ['diff-tree', '-p', '--no-renames', g.legacyBase, g.l1], {
      cwd: g.root,
      env: { ...fixtureEnv(), HOME: home },
    });
    const controlId = spawnSync('git', ['patch-id', '--stable'], {
      cwd: g.root,
      env: { ...fixtureEnv(), HOME: home },
      input: control.stdout,
    }).stdout.toString();
    expect(controlId).not.toBe(cleanId);
  });

  it('is unchanged under a repository-local replace ref, with a positive control', () => {
    const g = twoGraphs();
    const runGit = createDefaultRunGit({ cwd: g.root, env: fixtureEnv() });
    const manifest = manifestFor(g, runGit);
    const before = treeTuples(runGit, g.legacyBase, g.l1);
    expect(before.tuples).toHaveLength(1);
    // `refs/replace/<l1>` makes every default read of l1 return the base commit instead — state
    // that is neither configuration nor attributes, and that no OID in the manifest can name.
    git(g.root, ['replace', g.l1, g.legacyBase]);
    expect(treeTuples(runGit, g.legacyBase, g.l1)).toEqual(before);
    expect(verify(manifest, { runGit })).toEqual({ ok: true });
    // Positive control: the same diff-tree spawned without the pin sees an empty delta.
    const control = spawnSync(
      'git',
      ['diff-tree', '--no-commit-id', '--raw', '-r', '-z', '--no-renames', g.legacyBase, g.l1],
      { cwd: g.root, env: fixtureEnv() },
    );
    expect(control.status).toBe(0);
    expect(control.stdout.length).toBe(0);
  });

  it('reports adapter failures under their named codes', () => {
    const g = twoGraphs();
    const manifest = manifestFor(g, createDefaultRunGit({ cwd: g.root, env: fixtureEnv() }));
    const absent = createDefaultRunGit({
      cwd: g.root,
      env: fixtureEnv(),
      executable: path.join(g.root, 'no-such-git'),
    });
    expect(codesOf(verify(manifest, { runGit: absent }))).toEqual(['GIT_NOT_FOUND']);
    const nowhere = createDefaultRunGit({ cwd: path.join(g.root, 'missing'), env: fixtureEnv() });
    expect(codesOf(verify(manifest, { runGit: nowhere }))).toEqual(['CWD_NOT_FOUND']);
    const tiny = createDefaultRunGit({ cwd: g.root, env: fixtureEnv(), maxBufferBytes: 16 });
    expect(codesOf(verify(manifest, { runGit: tiny }))).toEqual(['PORT_OUTPUT_LIMIT']);
    expect(() => absent('merge-tree', [])).toThrow(TypeError);
  });
});

describe('CLI as a child process', () => {
  function runCli(args, { cwd, input, env = {} } = {}) {
    const { HARNESS_ROOT: _dropped, ...base } = fixtureEnv();
    return spawnSync(process.execPath, [MODULE, ...args], {
      cwd,
      env: { ...base, ...env },
      input,
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  const stderrLines = (result) => result.stderr.toString('utf8').split('\n').filter(Boolean);
  const diagnosticLines = (result) =>
    stderrLines(result).filter((line) => !line.startsWith('::root::'));

  it('maps pass, refuted, and aborted to exit 0, 1, and 2', () => {
    const g = twoGraphs();
    const runGit = createDefaultRunGit({ cwd: g.root, env: fixtureEnv() });
    const manifest = manifestFor(g, runGit);
    const file = path.join(g.root, 'manifest.json');
    writeFileSync(file, Buffer.from(canonicalize(manifest)));
    const pass = runCli(['verify', file, '--root', g.root], { cwd: g.root });
    expect(pass.status).toBe(0);
    expect(pass.stdout.toString()).toMatch(/^ok AGREEMENT-2664 /);
    const refutedManifest = clone(manifest);
    refutedManifest.records.splice(1, 1);
    writeFileSync(file, Buffer.from(canonicalize(refutedManifest)));
    const refuted = runCli(['verify', file, '--root', g.root], { cwd: g.root });
    expect(refuted.status).toBe(1);
    expect(diagnosticLines(refuted).some((line) => line.startsWith('UNRECORDED_COMMIT'))).toBe(
      true,
    );
    writeFileSync(file, '{');
    const malformed = runCli(['verify', file, '--root', g.root], { cwd: g.root });
    expect(malformed.status).toBe(2);
    expect(diagnosticLines(malformed)[0]).toMatch(/^MALFORMED_JSON/);
    expect(
      runCli(['verify', path.join(g.root, 'absent.json'), '--root', g.root], { cwd: g.root })
        .status,
    ).toBe(2);
    const nonRegular = runCli(['verify', g.root, '--root', g.root], { cwd: g.root });
    expect(nonRegular.status).toBe(2);
    expect(diagnosticLines(nonRegular)[0]).toMatch(/^USAGE/);
    const parse = runCli(['parse', file], { cwd: g.root });
    writeFileSync(file, Buffer.from(canonicalize(manifest)));
    const parsed = runCli(['parse', file], { cwd: g.root });
    expect(parse.status).toBe(2);
    expect(parsed.status).toBe(0);
    expect(parsed.stdout.toString()).toBe(`${digest(Buffer.from(canonicalize(manifest)))}\nok\n`);
    const usage = runCli(['frobnicate', file], { cwd: g.root });
    expect(usage.status).toBe(2);
  });

  it('accepts stdin at exactly 8 MiB and refuses one byte more', () => {
    const { manifest } = world();
    const size = clone(manifest);
    size.records.push({
      kind: 'legacy-only',
      legacy: oid('pad'),
      tuples: [],
      reason: 'r',
      evidence: 'e',
    });
    const withReason = (reason) => {
      size.records[size.records.length - 1].reason = reason;
      return Buffer.from(canonicalize(size));
    };
    const baseline = withReason('x').length;
    const exact = withReason('x'.repeat(MANIFEST_CEILINGS.bytes - baseline + 1));
    expect(exact.length).toBe(MANIFEST_CEILINGS.bytes);
    const accepted = runCli(['parse', '-'], { input: exact });
    expect(accepted.status).toBe(0);
    const over = withReason('x'.repeat(MANIFEST_CEILINGS.bytes - baseline + 2));
    const refused = runCli(['parse', '-'], { input: over });
    expect(refused.status).toBe(2);
    expect(refused.stdout.length).toBe(0);
    expect(diagnosticLines(refused)[0]).toMatch(/^SIZE_LIMIT/);
  });

  it('delivers a 4 MiB canonicalize byte-complete through a pipe, and exits 2 with one line on EPIPE', async () => {
    const { manifest } = world();
    const big = clone(manifest);
    big.records.push({
      kind: 'legacy-only',
      legacy: oid('big'),
      tuples: [],
      reason: 'y'.repeat(4 * 1024 * 1024),
      evidence: 'e',
    });
    const canonical = Buffer.from(canonicalize(big));
    expect(canonical.length).toBeGreaterThan(4 * 1024 * 1024);
    const pretty = Buffer.from(JSON.stringify(big, null, 1));
    const piped = runCli(['canonicalize', '-'], { input: pretty });
    expect(piped.status).toBe(0);
    expect(piped.stdout.equals(canonical)).toBe(true);

    const { HARNESS_ROOT: _dropped, ...env } = fixtureEnv();
    const child = spawn(process.execPath, [MODULE, 'canonicalize', '-'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stderr = [];
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.stdout.once('data', () => child.stdout.destroy());
    child.stdin.end(pretty);
    const code = await new Promise((resolve) => child.on('close', resolve));
    expect(code).toBe(2);
    const lines = Buffer.concat(stderr)
      .toString('utf8')
      .split('\n')
      .filter((line) => line && !line.startsWith('::root::'));
    expect(lines).toEqual([expect.stringMatching(/^STDOUT_EPIPE/)]);
  });
});
