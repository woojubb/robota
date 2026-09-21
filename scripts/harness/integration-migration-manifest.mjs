/**
 * The closed divergence manifest and its non-merge verifier (MANIFEST-2664, implemented by
 * VERIFIER-2664; issue #2664).
 *
 * ## What this is
 *
 * When a legacy integration history must be REPLACED rather than replayed byte-for-byte (the
 * AGREEMENT-2664 tip at `4214cb540` carries a prelude the plan-order contract rejects), the migration
 * rule in `.agents/rules/git-branch.md` § Branch Policy needs a form in which "how the replacement
 * differs from the legacy history, and that every difference was named" is stated once and re-derived
 * by a machine. That form is this manifest: one canonical JSON document (RFC 8785 body plus one `\n`,
 * SHA-256 over those exact bytes) binding two graphs by OID only — never by ref name — and, for every
 * non-merge commit in either graph, one record with exactly one disposition:
 *
 *   - `equal`            — legacy L and replacement R produce the same raw tree delta;
 *   - `diverged`         — L and R differ; both raw deltas are recorded, with a reason and evidence;
 *   - `replacement-only` — R has no legacy counterpart; its raw delta is recorded, with reason/evidence;
 *   - `legacy-only`      — L has no replacement counterpart; likewise.
 *
 * Merge commits are `merge` records binding the merge OID and its exactly two parents IN ORDER. Their
 * own-content (what an evil merge or a conflict resolution adds beyond Git's automatic merge) is NOT
 * verified by this module: that needs `git merge-tree --write-tree`, whose result depends on merge
 * configuration and on gitattributes sources Git cannot override; `MERGE-2664` owns that helper's
 * semantics and `BRANCH-2664-P2` adds the check.
 *
 * ## Equality authority
 *
 * The authority for a non-merge commit is the raw tree delta `git diff-tree --no-commit-id --raw -r -z
 * --no-renames <parent> <commit>` — plumbing, so `diff.renames`, `core.abbrev`, `core.quotePath` and
 * `diff.noprefix` never reach it (measured); `-z` and `--no-renames` pin what remains. A rename is two
 * tuples, delete plus add. A tuple is `{ pathBytesBase64, status, oldMode, newMode, oldOid, newOid }`,
 * the path kept as raw bytes because two distinct invalid byte sequences must never collapse into one
 * string. Object type is not stored: under `-r` it is a pure function of the mode.
 *
 * `git patch-id --stable` is a DIAGNOSTIC, not authority: a `diverged` record carries the three-valued
 * flag `patchIdEqual` (`true`, `false`, or `null` when either side's patch is empty — `patch-id` prints
 * nothing for an empty patch). The pair is `git diff-tree -p --no-renames --text <parent> <commit> |
 * git patch-id --stable`; `--text` is what makes the flag independent of every gitattributes source
 * (`core.attributesFile`, `$GIT_DIR/info/attributes`, an uncommitted worktree `.gitattributes`), each
 * measured to move the ID of an unpinned pair even under configuration isolation.
 *
 * ## Port and budget
 *
 * The one injection seam is `runGit(command, args, { timeoutMs })`, returning the `spawnSync` shape
 * `{ status, signal, error, stdout: Buffer, stderr: Buffer }` over the closed vocabulary `rev-parse`,
 * `merge-base`, `rev-list`, `diff-tree`, `patch-id`. `verify` owns a run-scoped budget ABOVE the port —
 * `createVerificationRuntime` from `verification-budget-runtime.mjs`, one `takeVerificationCommand`
 * per invocation — so the deadline and the invocation ceiling bind the default adapter and a fixture
 * reader identically. That runtime hands each invocation `min(10_000, remainingMs)`: the ten-second
 * per-invocation cap is an inherited, declared bound of this verifier.
 *
 * ## Results
 *
 * `verify` is three-valued and the states never mix: `{ ok: true }`; `{ ok: false, outcome:
 * 'refuted', findings }` — the manifest was fully checked (or refuted on ancestry alone) and disagrees
 * with the repository; `{ ok: false, outcome: 'aborted', diagnostics }` — the check could not
 * complete, and no findings ride on it. Every `code` is a member of `MANIFEST_DIAGNOSTIC_CODES`, the
 * frozen v1 set. Schema v1 is frozen: any added field or code is v2, refused here.
 *
 * ## Purity
 *
 * Importable, reads no environment of its own, lease-free. I/O happens only through the injected port
 * and, in the CLI, through the file the caller names.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { isEntryPoint } from './entrypoint.mjs';
import { envWithoutGitVars, resolveWorkspaceRoot } from './shared.mjs';
import {
  createVerificationRuntime,
  isVerificationBudgetError,
  takeVerificationCommand,
} from './verification-budget-runtime.mjs';

// ---------------------------------------------------------------------------------------------------
// The closed v1 vocabulary
// ---------------------------------------------------------------------------------------------------

export const SCHEMA_VERSION = 1;
export const OBJECT_FORMAT = 'sha1';

/** Manifest ceilings, checked before any Git call. `bytes` applies in `parseManifest` and the CLI. */
export const MANIFEST_CEILINGS = Object.freeze({
  bytes: 8 * 1024 * 1024,
  segments: 64,
  records: 4096,
  tuples: 100_000,
});

export const DEFAULT_LIMITS = Object.freeze({ timeoutMs: 600_000, commandBudget: 32_768 });
export const DEFAULT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
export const DEFAULT_PORT_TIMEOUT_MS = 10_000;

export const PORT_COMMANDS = Object.freeze([
  'rev-parse',
  'merge-base',
  'rev-list',
  'diff-tree',
  'patch-id',
]);

export const MANIFEST_DIAGNOSTIC_CODES = Object.freeze({
  parse: Object.freeze([
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
  ]),
  refuted: Object.freeze([
    'BASES_NOT_ANCESTRAL',
    'TIP_NOT_DESCENDANT',
    'UNRECORDED_COMMIT',
    'INVENTED_RECORD',
    'PARENT_CARDINALITY',
    'SEGMENT_MEMBERSHIP',
    'TUPLES_MISMATCH',
    'EQUAL_NOT_EQUAL',
    'PATCH_ID_FLAG_MISMATCH',
  ]),
  aborted: Object.freeze([
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
  ]),
});

const ALL_CODES = new Set([
  ...MANIFEST_DIAGNOSTIC_CODES.parse,
  ...MANIFEST_DIAGNOSTIC_CODES.refuted,
  ...MANIFEST_DIAGNOSTIC_CODES.aborted,
]);

const OID = /^[0-9a-f]{40}$/;
const MODE = /^[0-7]{6}$/;
// eslint-disable-next-line no-control-regex
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
const STATUSES = new Set(['A', 'D', 'M', 'T']);
const SIDES = ['legacy', 'replacement'];

const TOP_FIELDS = [
  'schemaVersion',
  'objectFormat',
  'agreementId',
  'issue',
  'legacyBase',
  'replacementBase',
  'legacyTip',
  'replacementTip',
  'segments',
  'records',
];
const SEGMENT_FIELDS = ['id', 'legacy', 'replacement'];
const SEGMENT_SIDE_FIELDS = ['predecessor', 'commits'];
const TUPLE_FIELDS = ['pathBytesBase64', 'status', 'oldMode', 'newMode', 'oldOid', 'newOid'];
const RECORD_FIELDS = {
  equal: ['kind', 'legacy', 'replacement'],
  diverged: [
    'kind',
    'legacy',
    'replacement',
    'legacyTuples',
    'replacementTuples',
    'patchIdEqual',
    'reason',
    'evidence',
  ],
  'replacement-only': ['kind', 'replacement', 'tuples', 'reason', 'evidence'],
  'legacy-only': ['kind', 'legacy', 'tuples', 'reason', 'evidence'],
  merge: ['kind', 'graph', 'oid', 'parents'],
};

function item(code, at, message) {
  if (!ALL_CODES.has(code)) throw new Error(`${code} is not a manifest diagnostic code`);
  return { code, path: at, message };
}

// ---------------------------------------------------------------------------------------------------
// Canonical bytes (RFC 8785 body + one `\n`) and digest
// ---------------------------------------------------------------------------------------------------

function canonicalValue(value, at) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError(`${at}: only integers are canonical`);
    return String(value);
  }
  if (typeof value === 'string') {
    if (!PRINTABLE_ASCII.test(value)) {
      throw new TypeError(`${at}: strings must be printable ASCII`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry, index) => canonicalValue(entry, `${at}[${index}]`)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const members = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key], `${at}.${key}`)}`);
    return `{${members.join(',')}}`;
  }
  throw new TypeError(`${at}: ${typeof value} is not a JSON value`);
}

/** RFC 8785 canonical bytes of a manifest value, followed by exactly one `\n`. */
export function canonicalize(manifest) {
  return new Uint8Array(Buffer.from(`${canonicalValue(manifest, '$')}\n`, 'utf8'));
}

/** SHA-256 over the exact bytes given, lowercase hex. */
export function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// ---------------------------------------------------------------------------------------------------
// Tuples
// ---------------------------------------------------------------------------------------------------

function compareTuples(a, b) {
  const byPath = Buffer.compare(
    Buffer.from(a.pathBytesBase64, 'base64'),
    Buffer.from(b.pathBytesBase64, 'base64'),
  );
  if (byPath !== 0) return byPath;
  for (const key of ['status', 'oldMode', 'newMode', 'oldOid', 'newOid']) {
    if (a[key] < b[key]) return -1;
    if (a[key] > b[key]) return 1;
  }
  return 0;
}

function pickTuple({ pathBytesBase64, status, oldMode, newMode, oldOid, newOid }) {
  return { pathBytesBase64, status, oldMode, newMode, oldOid, newOid };
}

/** Tuples in canonical order: decoded path bytes, then the remaining fixed fields. */
export function sortTuples(tuples) {
  return tuples.map(pickTuple).sort(compareTuples);
}

/**
 * Parse `git diff-tree --raw -r -z` output — `:<oldmode> <newmode> <oldoid> <newoid> <status>\0<path>\0`
 * per entry, the path as raw bytes. Rename and copy statuses never appear because `--no-renames` is
 * pinned; anything else is a port failure, never a guess.
 */
export function parseRawTuples(stdout) {
  const tuples = [];
  let offset = 0;
  while (offset < stdout.length) {
    const metaEnd = stdout.indexOf(0, offset);
    if (metaEnd < 0) return { ok: false, message: 'truncated raw entry' };
    const meta = stdout.subarray(offset, metaEnd).toString('latin1');
    const match = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([ADMT])$/.exec(meta);
    if (!match) return { ok: false, message: `unrecognised raw entry ${JSON.stringify(meta)}` };
    const pathEnd = stdout.indexOf(0, metaEnd + 1);
    if (pathEnd < 0) return { ok: false, message: 'truncated raw path' };
    if (pathEnd === metaEnd + 1) return { ok: false, message: 'empty raw path' };
    tuples.push({
      pathBytesBase64: Buffer.from(stdout.subarray(metaEnd + 1, pathEnd)).toString('base64'),
      status: match[5],
      oldMode: match[1],
      newMode: match[2],
      oldOid: match[3],
      newOid: match[4],
    });
    offset = pathEnd + 1;
  }
  return { ok: true, tuples: sortTuples(tuples) };
}

function sameTuples(a, b) {
  return JSON.stringify(sortTuples(a)) === JSON.stringify(sortTuples(b));
}

// ---------------------------------------------------------------------------------------------------
// Schema v1
// ---------------------------------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkFields(object, allowed, at, out) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) out.push(item('UNKNOWN_FIELD', `${at}.${key}`, 'unknown field'));
  }
  for (const key of allowed) {
    if (!(key in object)) out.push(item('MISSING_FIELD', `${at}.${key}`, 'missing field'));
  }
}

function checkOid(value, at, out) {
  if (typeof value === 'string' && OID.test(value)) return true;
  out.push(item('INVALID_FIELD', at, 'expected a 40-hex lowercase SHA-1 object id'));
  return false;
}

function checkAscii(value, at, out, nonEmpty) {
  if (typeof value === 'string' && PRINTABLE_ASCII.test(value) && (!nonEmpty || value !== '')) {
    return true;
  }
  out.push(item('INVALID_FIELD', at, 'expected a printable-ASCII string'));
  return false;
}

function checkTuple(tuple, at, out) {
  if (!isPlainObject(tuple)) {
    out.push(item('INVALID_FIELD', at, 'expected a tuple object'));
    return;
  }
  checkFields(tuple, TUPLE_FIELDS, at, out);
  const base64 = tuple.pathBytesBase64;
  if (
    typeof base64 !== 'string' ||
    base64 === '' ||
    Buffer.from(base64, 'base64').toString('base64') !== base64
  ) {
    out.push(item('INVALID_FIELD', `${at}.pathBytesBase64`, 'expected canonical non-empty base64'));
  }
  if (!STATUSES.has(tuple.status)) {
    out.push(item('INVALID_FIELD', `${at}.status`, 'expected one of A, D, M, T'));
  }
  for (const key of ['oldMode', 'newMode']) {
    if (typeof tuple[key] !== 'string' || !MODE.test(tuple[key])) {
      out.push(item('INVALID_FIELD', `${at}.${key}`, 'expected a six-digit octal mode'));
    }
  }
  checkOid(tuple.oldOid, `${at}.oldOid`, out);
  checkOid(tuple.newOid, `${at}.newOid`, out);
}

function checkTuples(tuples, at, out) {
  if (!Array.isArray(tuples)) {
    out.push(item('INVALID_FIELD', at, 'expected an array of tuples'));
    return 0;
  }
  const before = out.length;
  tuples.forEach((tuple, index) => checkTuple(tuple, `${at}[${index}]`, out));
  if (
    out.length === before &&
    JSON.stringify(sortTuples(tuples)) !== JSON.stringify(tuples.map(pickTuple))
  ) {
    out.push(item('INVALID_FIELD', at, 'tuples are not in canonical order'));
  }
  return tuples.length;
}

function checkSegmentSide(side, at, out) {
  if (!isPlainObject(side)) {
    out.push(item('INVALID_FIELD', at, 'expected a segment side object'));
    return;
  }
  checkFields(side, SEGMENT_SIDE_FIELDS, at, out);
  checkOid(side.predecessor, `${at}.predecessor`, out);
  if (!Array.isArray(side.commits)) {
    out.push(item('INVALID_FIELD', `${at}.commits`, 'expected an array of object ids'));
    return;
  }
  side.commits.forEach((oid, index) => checkOid(oid, `${at}.commits[${index}]`, out));
}

function checkRecord(record, at, out, claim) {
  if (!isPlainObject(record)) {
    out.push(item('INVALID_FIELD', at, 'expected a record object'));
    return 0;
  }
  const { kind } = record;
  if (!(kind in RECORD_FIELDS)) {
    out.push(
      item(
        'INVALID_FIELD',
        `${at}.kind`,
        'expected equal, diverged, replacement-only, legacy-only, or merge',
      ),
    );
    return 0;
  }
  checkFields(record, RECORD_FIELDS[kind], at, out);
  if (kind === 'merge') {
    const graphOk = SIDES.includes(record.graph);
    if (!graphOk) out.push(item('INVALID_FIELD', `${at}.graph`, 'expected legacy or replacement'));
    if (checkOid(record.oid, `${at}.oid`, out) && graphOk) claim(record.graph, record.oid, at);
    if (!Array.isArray(record.parents) || record.parents.length !== 2) {
      out.push(item('INVALID_FIELD', `${at}.parents`, 'expected exactly two parent object ids'));
    } else {
      record.parents.forEach((oid, index) => checkOid(oid, `${at}.parents[${index}]`, out));
    }
    return 0;
  }
  if (kind !== 'replacement-only' && checkOid(record.legacy, `${at}.legacy`, out)) {
    claim('legacy', record.legacy, at);
  }
  if (kind !== 'legacy-only' && checkOid(record.replacement, `${at}.replacement`, out)) {
    claim('replacement', record.replacement, at);
  }
  let tupleCount = 0;
  if (kind === 'diverged') {
    tupleCount += checkTuples(record.legacyTuples, `${at}.legacyTuples`, out);
    tupleCount += checkTuples(record.replacementTuples, `${at}.replacementTuples`, out);
    if (![true, false, null].includes(record.patchIdEqual)) {
      out.push(item('INVALID_FIELD', `${at}.patchIdEqual`, 'expected true, false, or null'));
    }
  } else if (kind !== 'equal') {
    tupleCount += checkTuples(record.tuples, `${at}.tuples`, out);
  }
  if (kind !== 'equal') {
    checkAscii(record.reason, `${at}.reason`, out, true);
    checkAscii(record.evidence, `${at}.evidence`, out, true);
  }
  return tupleCount;
}

/** Validate a value against schema v1. Pure. Returns `[]` when valid. */
export function validateManifest(value) {
  const out = [];
  if (!isPlainObject(value)) return [item('INVALID_FIELD', '$', 'expected a JSON object')];
  checkFields(value, TOP_FIELDS, '$', out);
  if (value.schemaVersion !== SCHEMA_VERSION) {
    out.push(item('UNSUPPORTED_SCHEMA_VERSION', '$.schemaVersion', `expected ${SCHEMA_VERSION}`));
  }
  if (value.objectFormat !== OBJECT_FORMAT) {
    out.push(item('UNSUPPORTED_OBJECT_FORMAT', '$.objectFormat', `expected ${OBJECT_FORMAT}`));
  }
  checkAscii(value.agreementId, '$.agreementId', out, true);
  if (!Number.isSafeInteger(value.issue) || value.issue < 1) {
    out.push(item('INVALID_FIELD', '$.issue', 'expected a positive integer issue number'));
  }
  for (const key of ['legacyBase', 'replacementBase', 'legacyTip', 'replacementTip']) {
    checkOid(value[key], `$.${key}`, out);
  }
  if (!Array.isArray(value.segments)) {
    out.push(item('INVALID_FIELD', '$.segments', 'expected an array of segments'));
  } else {
    if (value.segments.length > MANIFEST_CEILINGS.segments) {
      out.push(
        item(
          'SEGMENT_LIMIT',
          '$.segments',
          `${value.segments.length} segments exceed ${MANIFEST_CEILINGS.segments}`,
        ),
      );
    }
    const ids = new Set();
    value.segments.forEach((segment, index) => {
      const at = `$.segments[${index}]`;
      if (!isPlainObject(segment)) {
        out.push(item('INVALID_FIELD', at, 'expected a segment object'));
        return;
      }
      checkFields(segment, SEGMENT_FIELDS, at, out);
      if (checkAscii(segment.id, `${at}.id`, out, true)) {
        if (ids.has(segment.id))
          out.push(item('INVALID_FIELD', `${at}.id`, 'duplicate segment id'));
        ids.add(segment.id);
      }
      for (const side of SIDES) checkSegmentSide(segment[side], `${at}.${side}`, out);
    });
  }
  if (!Array.isArray(value.records)) {
    out.push(item('INVALID_FIELD', '$.records', 'expected an array of records'));
    return out;
  }
  if (value.records.length > MANIFEST_CEILINGS.records) {
    out.push(
      item(
        'RECORD_LIMIT',
        '$.records',
        `${value.records.length} records exceed ${MANIFEST_CEILINGS.records}`,
      ),
    );
  }
  const claimed = new Map();
  const claim = (side, oid, at) => {
    const key = `${side}:${oid}`;
    if (claimed.has(key)) {
      out.push(
        item(
          'DUPLICATE_RECORD',
          at,
          `${side} commit ${oid} is already recorded at ${claimed.get(key)}`,
        ),
      );
    } else claimed.set(key, at);
  };
  let tupleCount = 0;
  value.records.forEach((record, index) => {
    tupleCount += checkRecord(record, `$.records[${index}]`, out, claim);
  });
  if (tupleCount > MANIFEST_CEILINGS.tuples) {
    out.push(
      item('TUPLE_LIMIT', '$.records', `${tupleCount} tuples exceed ${MANIFEST_CEILINGS.tuples}`),
    );
  }
  return out;
}

/**
 * The only reader. Strict mode (the default) refuses bytes that are not the canonical serialisation
 * of the value they encode; `strict: false` accepts any RFC 8259 JSON that satisfies the schema, which
 * is what the `canonicalize` subcommand needs to turn an author's draft into canonical bytes.
 */
export function parseManifest(bytes, { strict = true } = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length > MANIFEST_CEILINGS.bytes) {
    return {
      ok: false,
      diagnostics: [
        item('SIZE_LIMIT', '$', `${buffer.length} bytes exceed ${MANIFEST_CEILINGS.bytes}`),
      ],
    };
  }
  let value;
  try {
    value = JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    return { ok: false, diagnostics: [item('MALFORMED_JSON', '$', error.message)] };
  }
  const diagnostics = validateManifest(value);
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  if (strict && !Buffer.from(canonicalize(value)).equals(buffer)) {
    return {
      ok: false,
      diagnostics: [
        item('NONCANONICAL_BYTES', '$', 'bytes are not the canonical serialisation of their value'),
      ],
    };
  }
  return { ok: true, manifest: value };
}

// ---------------------------------------------------------------------------------------------------
// The port: failure classification and the default adapter
// ---------------------------------------------------------------------------------------------------

function firstLine(buffer) {
  return (Buffer.isBuffer(buffer) ? buffer.toString('utf8') : '').split(/\r?\n/, 1)[0];
}

/** Null when the result is usable; otherwise the `aborted` diagnostic it maps to. */
function portFailure(command, args, result, accept = []) {
  const where = `git ${[command, ...args].join(' ')}`;
  if (!result || typeof result !== 'object')
    return item('PORT_FAILURE', where, 'port returned no result');
  if (result.error) {
    const { code, message } = result.error;
    if (code === 'ETIMEDOUT')
      return item('PORT_TIMEOUT', where, 'the invocation exceeded its timeout');
    if (code === 'ENOBUFS')
      return item('PORT_OUTPUT_LIMIT', where, 'the invocation exceeded the output ceiling');
    if (code === 'CWD_NOT_FOUND')
      return item('CWD_NOT_FOUND', where, message ?? 'working directory missing');
    if (code === 'ENOENT') return item('GIT_NOT_FOUND', where, 'the git executable was not found');
    return item('PORT_FAILURE', where, `${code ?? 'error'}: ${message ?? ''}`.trim());
  }
  if (result.signal) return item('PORT_FAILURE', where, `terminated by ${result.signal}`);
  if (result.status !== 0 && !accept.includes(result.status)) {
    return item('PORT_FAILURE', where, `exit ${result.status}: ${firstLine(result.stderr)}`);
  }
  return null;
}

function asBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.alloc(0);
}

function failure(code, message) {
  return {
    status: null,
    signal: null,
    error: { code, message },
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
  };
}

/**
 * The default adapter: real Git, one `spawnSync` per invocation (two for the `patch-id` pair), with
 * `cwd` and `env` injected so a `--pool=threads` test worker can target a fixture repository, the
 * environment stripped of hook-inherited `GIT_*` variables and isolated from global and system
 * configuration. Construction never throws: a `cwd` that is not a directory yields a port whose every
 * call reports `CWD_NOT_FOUND`.
 */
export function createDefaultRunGit({
  cwd,
  env = process.env,
  executable = 'git',
  maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
  defaultTimeoutMs = DEFAULT_PORT_TIMEOUT_MS,
} = {}) {
  const spawnEnv = {
    ...envWithoutGitVars(env),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const cwdIsDirectory = () => {
    try {
      return typeof cwd === 'string' && statSync(cwd).isDirectory();
    } catch {
      return false;
    }
  };
  const spawn = (argv, timeoutMs, input) => {
    const raw = spawnSync(executable, argv, {
      cwd,
      env: spawnEnv,
      input,
      timeout: timeoutMs,
      maxBuffer: maxBufferBytes,
      windowsHide: true,
    });
    if (raw.error?.code === 'ENOENT' && !cwdIsDirectory()) {
      return failure('CWD_NOT_FOUND', `working directory ${cwd} does not exist`);
    }
    return {
      status: raw.status ?? null,
      signal: raw.signal ?? null,
      error: raw.error ?? undefined,
      stdout: asBuffer(raw.stdout),
      stderr: asBuffer(raw.stderr),
    };
  };
  return function runGit(command, args, { timeoutMs = defaultTimeoutMs } = {}) {
    if (!PORT_COMMANDS.includes(command)) throw new TypeError(`${command} is not a port command`);
    if (!cwdIsDirectory())
      return failure('CWD_NOT_FOUND', `working directory ${cwd} is not a directory`);
    if (command !== 'patch-id') return spawn([command, ...args], timeoutMs);
    // `diff-tree -p --no-renames --text <parent> <commit> | patch-id --stable`: one budget take, the
    // second spawn bounded by what the first left of the timeout (`spawnSync` treats 0 as unbounded
    // and refuses a negative or fractional value, so a spent timeout is reported without spawning).
    const started = Date.now();
    const patch = spawn(['diff-tree', '-p', '--no-renames', '--text', args[0], args[1]], timeoutMs);
    if (patch.error || patch.signal || patch.status !== 0 || patch.stdout.length === 0)
      return patch;
    const remaining = Math.floor(timeoutMs - (Date.now() - started));
    if (remaining < 1) return failure('ETIMEDOUT', 'patch-id pair exceeded its timeout');
    return spawn(['patch-id', '--stable'], remaining, patch.stdout);
  };
}

// ---------------------------------------------------------------------------------------------------
// Producer primitives — exported so a manifest author derives tuples from the recomputing code
// ---------------------------------------------------------------------------------------------------

/** The raw tree delta between a commit and its parent, as canonical tuples. */
export function treeTuples(runGit, parent, commit, options = {}) {
  const args = ['--no-commit-id', '--raw', '-r', '-z', '--no-renames', parent, commit];
  const result = runGit('diff-tree', args, options);
  const failed = portFailure('diff-tree', args, result);
  if (failed) return { ok: false, diagnostics: [failed] };
  const parsed = parseRawTuples(result.stdout);
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: [item('PORT_FAILURE', `git diff-tree ${args.join(' ')}`, parsed.message)],
    };
  }
  return { ok: true, tuples: parsed.tuples };
}

/** Every commit in `<base>..<tip>` with its parents, from one `rev-list --parents`. */
export function enumerate(runGit, base, tip, options = {}) {
  const args = ['--parents', `${base}..${tip}`];
  const result = runGit('rev-list', args, options);
  const where = `git rev-list ${args.join(' ')}`;
  if (result?.status === 128 && !result.error && !result.signal) {
    return { ok: false, diagnostics: [item('UNKNOWN_OID', where, firstLine(result.stderr))] };
  }
  const failed = portFailure('rev-list', args, result);
  if (failed) return { ok: false, diagnostics: [failed] };
  const commits = [];
  for (const line of result.stdout.toString('utf8').split('\n')) {
    if (line === '') continue;
    const [oid, ...parents] = line.trim().split(' ');
    if (!OID.test(oid) || parents.some((parent) => !OID.test(parent))) {
      return {
        ok: false,
        diagnostics: [item('PORT_FAILURE', where, `unrecognised row ${JSON.stringify(line)}`)],
      };
    }
    commits.push({ oid, parents });
  }
  return { ok: true, commits };
}

function patchId(runGit, parent, commit, options) {
  const args = [parent, commit];
  const result = runGit('patch-id', args, options);
  const failed = portFailure('patch-id', args, result);
  if (failed) return { ok: false, diagnostics: [failed] };
  const text = result.stdout.toString('utf8').trim();
  if (text === '') return { ok: true, id: null };
  const id = text.split(/\s+/, 1)[0];
  if (!OID.test(id)) {
    return {
      ok: false,
      diagnostics: [
        item(
          'PORT_FAILURE',
          `git patch-id ${args.join(' ')}`,
          `unrecognised output ${JSON.stringify(text)}`,
        ),
      ],
    };
  }
  return { ok: true, id };
}

// ---------------------------------------------------------------------------------------------------
// The verifier core
// ---------------------------------------------------------------------------------------------------

class Abort extends Error {
  constructor(diagnostics) {
    super('verification aborted');
    this.diagnostics = diagnostics;
  }
}

function abort(diagnostics) {
  throw new Abort(diagnostics);
}

function ancestry(port, ancestor, descendant, code, at) {
  const args = ['--is-ancestor', ancestor, descendant];
  const result = port('merge-base', args);
  if (result?.status === 128 && !result.error && !result.signal) {
    abort([item('UNKNOWN_OID', `git merge-base ${args.join(' ')}`, firstLine(result.stderr))]);
  }
  const failed = portFailure('merge-base', args, result, [1]);
  if (failed) abort([failed]);
  return result.status === 0
    ? null
    : item(code, at, `${ancestor} is not an ancestor of ${descendant}`);
}

/** Cardinality and segment checks for one side; returns the graph as oid → parents. */
function checkSide(side, manifest, commits, findings) {
  const graph = new Map(commits.map((commit) => [commit.oid, commit.parents]));
  const recorded = new Set();
  manifest.records.forEach((record, index) => {
    const at = `$.records[${index}]`;
    if (record.kind === 'merge') {
      if (record.graph !== side) return;
      recorded.add(record.oid);
      const parents = graph.get(record.oid);
      if (parents === undefined) {
        findings.push(
          item(
            'INVENTED_RECORD',
            at,
            `${side} commit ${record.oid} is not in ${side}Base..${side}Tip`,
          ),
        );
      } else if (
        parents.length !== 2 ||
        parents[0] !== record.parents[0] ||
        parents[1] !== record.parents[1]
      ) {
        findings.push(
          item(
            'PARENT_CARDINALITY',
            at,
            `${side} merge ${record.oid} has parents ${parents.join(', ')}, not ${record.parents.join(', ')}`,
          ),
        );
      }
      return;
    }
    const oid = record[side];
    if (oid === undefined) return;
    recorded.add(oid);
    const parents = graph.get(oid);
    if (parents === undefined) {
      findings.push(
        item('INVENTED_RECORD', at, `${side} commit ${oid} is not in ${side}Base..${side}Tip`),
      );
    } else if (parents.length !== 1) {
      findings.push(
        item(
          'PARENT_CARDINALITY',
          at,
          `${side} commit ${oid} has ${parents.length} parents; a non-merge record needs exactly one`,
        ),
      );
    }
  });
  for (const commit of commits) {
    if (!recorded.has(commit.oid)) {
      findings.push(
        item('UNRECORDED_COMMIT', '$.records', `${side} commit ${commit.oid} has no record`),
      );
    }
  }
  // Segments: membership is the set of single-parent commits; order is the parent chain.
  const members = new Set();
  manifest.segments.forEach((segment, index) => {
    const at = `$.segments[${index}].${side}`;
    let previous = segment[side].predecessor;
    segment[side].commits.forEach((oid, position) => {
      const where = `${at}.commits[${position}]`;
      if (members.has(oid)) {
        findings.push(
          item(
            'SEGMENT_MEMBERSHIP',
            where,
            `${side} commit ${oid} appears in more than one segment`,
          ),
        );
      }
      members.add(oid);
      const parents = graph.get(oid);
      if (parents === undefined) {
        findings.push(
          item(
            'SEGMENT_MEMBERSHIP',
            where,
            `${side} commit ${oid} is not in ${side}Base..${side}Tip`,
          ),
        );
      } else if (parents.length !== 1 || parents[0] !== previous) {
        findings.push(
          item(
            'SEGMENT_MEMBERSHIP',
            where,
            `${side} commit ${oid} does not follow ${previous} by its sole parent`,
          ),
        );
      }
      previous = oid;
    });
  });
  for (const commit of commits) {
    if (commit.parents.length === 1 && !members.has(commit.oid)) {
      findings.push(
        item(
          'SEGMENT_MEMBERSHIP',
          '$.segments',
          `${side} commit ${commit.oid} belongs to no segment`,
        ),
      );
    }
  }
  return graph;
}

/**
 * Verify a manifest against the repository behind `runGit`. Total over any value: the schema and the
 * pre-Git ceilings are re-checked here. The three ancestry checks run before enumeration and refute
 * alone when any fires.
 */
export function verify(manifest, { runGit, now = Date.now, limits = DEFAULT_LIMITS } = {}) {
  if (typeof runGit !== 'function') throw new TypeError('verify requires a runGit port');
  const aborted = (diagnostics) => ({ ok: false, outcome: 'aborted', diagnostics });
  const schema = validateManifest(manifest);
  if (schema.length > 0) return aborted(schema);
  let runtime;
  try {
    runtime = createVerificationRuntime({
      now,
      timeoutMs: limits?.timeoutMs,
      commandBudget: limits?.commandBudget,
      queryBudget: 0,
    });
  } catch (error) {
    return aborted([item('INVALID_LIMITS', '$', error.message)]);
  }
  const port = (command, args) => {
    let timeoutMs;
    try {
      timeoutMs = takeVerificationCommand(runtime);
    } catch (error) {
      if (isVerificationBudgetError(error))
        abort([item('BUDGET_EXHAUSTED', `git ${command}`, error.message)]);
      throw error;
    }
    try {
      return runGit(command, args, { timeoutMs });
    } catch (error) {
      abort([item('UNEXPECTED_ERROR', `git ${command}`, error?.message ?? String(error))]);
    }
    return undefined;
  };
  const findings = [];
  try {
    const formatArgs = ['--show-object-format'];
    const format = port('rev-parse', formatArgs);
    const formatFailed = portFailure('rev-parse', formatArgs, format);
    if (formatFailed) abort([formatFailed]);
    const actual = format.stdout.toString('utf8').trim();
    if (actual !== OBJECT_FORMAT) {
      abort([
        item(
          'REPOSITORY_OBJECT_FORMAT',
          'git rev-parse --show-object-format',
          `repository object format is ${actual || '(empty)'}, not ${OBJECT_FORMAT}`,
        ),
      ]);
    }
    for (const finding of [
      ancestry(
        port,
        manifest.legacyBase,
        manifest.replacementBase,
        'BASES_NOT_ANCESTRAL',
        '$.replacementBase',
      ),
      ancestry(port, manifest.legacyBase, manifest.legacyTip, 'TIP_NOT_DESCENDANT', '$.legacyTip'),
      ancestry(
        port,
        manifest.replacementBase,
        manifest.replacementTip,
        'TIP_NOT_DESCENDANT',
        '$.replacementTip',
      ),
    ]) {
      if (finding) findings.push(finding);
    }
    if (findings.length > 0) return { ok: false, outcome: 'refuted', findings };

    const graphs = {};
    for (const side of SIDES) {
      const listed = enumerate(port, manifest[`${side}Base`], manifest[`${side}Tip`]);
      if (!listed.ok) abort(listed.diagnostics);
      graphs[side] = checkSide(side, manifest, listed.commits, findings);
    }
    const cache = new Map();
    const tuplesOf = (side, oid) => {
      const parents = graphs[side].get(oid);
      if (!parents || parents.length !== 1) return null;
      const key = `${parents[0]} ${oid}`;
      if (!cache.has(key)) {
        const computed = treeTuples(port, parents[0], oid);
        if (!computed.ok) abort(computed.diagnostics);
        cache.set(key, computed.tuples);
      }
      return cache.get(key);
    };
    manifest.records.forEach((record, index) => {
      const at = `$.records[${index}]`;
      if (record.kind === 'merge') return;
      if (record.kind === 'equal') {
        const left = tuplesOf('legacy', record.legacy);
        const right = tuplesOf('replacement', record.replacement);
        if (left !== null && right !== null && !sameTuples(left, right)) {
          findings.push(
            item(
              'EQUAL_NOT_EQUAL',
              at,
              `legacy ${record.legacy} and replacement ${record.replacement} recompute to different tuple sets`,
            ),
          );
        }
        return;
      }
      if (record.kind === 'diverged') {
        const left = tuplesOf('legacy', record.legacy);
        const right = tuplesOf('replacement', record.replacement);
        if (left !== null && !sameTuples(left, record.legacyTuples)) {
          findings.push(
            item(
              'TUPLES_MISMATCH',
              `${at}.legacyTuples`,
              `recomputed tuples for legacy ${record.legacy} differ from the record`,
            ),
          );
        }
        if (right !== null && !sameTuples(right, record.replacementTuples)) {
          findings.push(
            item(
              'TUPLES_MISMATCH',
              `${at}.replacementTuples`,
              `recomputed tuples for replacement ${record.replacement} differ from the record`,
            ),
          );
        }
        if (left === null || right === null) return;
        const leftId = patchId(port, graphs.legacy.get(record.legacy)[0], record.legacy);
        if (!leftId.ok) abort(leftId.diagnostics);
        const rightId = patchId(
          port,
          graphs.replacement.get(record.replacement)[0],
          record.replacement,
        );
        if (!rightId.ok) abort(rightId.diagnostics);
        const flag = leftId.id === null || rightId.id === null ? null : leftId.id === rightId.id;
        if (flag !== record.patchIdEqual) {
          findings.push(
            item(
              'PATCH_ID_FLAG_MISMATCH',
              `${at}.patchIdEqual`,
              `recomputed patch-id equality is ${String(flag)}, not ${String(record.patchIdEqual)}`,
            ),
          );
        }
        return;
      }
      const side = record.kind === 'legacy-only' ? 'legacy' : 'replacement';
      const computed = tuplesOf(side, record[side]);
      if (computed !== null && !sameTuples(computed, record.tuples)) {
        findings.push(
          item(
            'TUPLES_MISMATCH',
            `${at}.tuples`,
            `recomputed tuples for ${side} ${record[side]} differ from the record`,
          ),
        );
      }
    });
  } catch (error) {
    if (error instanceof Abort) return aborted(error.diagnostics);
    throw error;
  }
  return findings.length === 0 ? { ok: true } : { ok: false, outcome: 'refuted', findings };
}

// ---------------------------------------------------------------------------------------------------
// CLI: parse | canonicalize | verify <path|->
// ---------------------------------------------------------------------------------------------------

const USAGE =
  'usage: integration-migration-manifest.mjs <parse|canonicalize|verify> <manifest-path|-> [--root <dir>]';

class UsageError extends Error {}

function writeDiagnostics(stderr, items) {
  for (const entry of items) stderr.write(`${entry.code} ${entry.path} — ${entry.message}\n`);
}

async function readManifestBytes(target, stdin) {
  const ceiling = MANIFEST_CEILINGS.bytes;
  if (target === '-') {
    if (stdin.isTTY)
      throw new UsageError('stdin is a terminal; pass a manifest path or pipe one in');
    const chunks = [];
    let total = 0;
    for await (const chunk of stdin) {
      total += chunk.length;
      if (total > ceiling) {
        return {
          ok: false,
          diagnostics: [item('SIZE_LIMIT', '-', `stdin exceeds ${ceiling} bytes`)],
        };
      }
      chunks.push(chunk);
    }
    return { ok: true, bytes: Buffer.concat(chunks) };
  }
  let stats;
  try {
    stats = statSync(target);
  } catch (error) {
    throw new UsageError(`${target}: ${error.code ?? error.message}`);
  }
  if (!stats.isFile()) throw new UsageError(`${target} is not a regular file`);
  if (stats.size > ceiling) {
    return {
      ok: false,
      diagnostics: [item('SIZE_LIMIT', target, `${stats.size} bytes exceed ${ceiling}`)],
    };
  }
  return { ok: true, bytes: await readFile(target) };
}

/** The CLI body; returns the exit code and writes only through the streams it is given. */
export async function main({
  argv = process.argv.slice(2),
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  root,
} = {}) {
  try {
    const positional = argv.filter(
      (arg, index) => !arg.startsWith('--root') && argv[index - 1] !== '--root',
    );
    const [subcommand, target] = positional;
    if (positional.length !== 2 || !['parse', 'canonicalize', 'verify'].includes(subcommand)) {
      throw new UsageError(USAGE);
    }
    const read = await readManifestBytes(target, stdin);
    if (!read.ok) {
      writeDiagnostics(stderr, read.diagnostics);
      return 2;
    }
    const parsed = parseManifest(read.bytes, { strict: subcommand !== 'canonicalize' });
    if (!parsed.ok) {
      writeDiagnostics(stderr, parsed.diagnostics);
      return 2;
    }
    if (subcommand === 'canonicalize') {
      stdout.write(Buffer.from(canonicalize(parsed.manifest)));
      return 0;
    }
    if (subcommand === 'parse') {
      stdout.write(`${digest(read.bytes)}\nok\n`);
      return 0;
    }
    const cwd =
      root ??
      resolveWorkspaceRoot(import.meta, { argv: [process.argv[0], process.argv[1], ...argv] });
    const result = verify(parsed.manifest, { runGit: createDefaultRunGit({ cwd }) });
    if (result.ok) {
      const { manifest } = parsed;
      stdout.write(
        `ok ${manifest.agreementId} ${manifest.records.length} record(s), ${manifest.segments.length} segment(s)\n`,
      );
      return 0;
    }
    if (result.outcome === 'refuted') {
      writeDiagnostics(stderr, result.findings);
      stdout.write(`refuted ${result.findings.length} finding(s)\n`);
      return 1;
    }
    writeDiagnostics(stderr, result.diagnostics);
    return 2;
  } catch (error) {
    if (error instanceof UsageError) {
      stderr.write(`USAGE - — ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

if (isEntryPoint(import.meta)) {
  // Installed by the guarded entry only: a module-scope listener would attach to every importer.
  process.stdout.on('error', (error) => {
    const code = error?.code === 'EPIPE' ? 'STDOUT_EPIPE' : 'UNEXPECTED_ERROR';
    process.stderr.write(
      `${code} - — ${error?.code === 'EPIPE' ? 'stdout closed before the output was written' : (error?.message ?? String(error))}\n`,
    );
    process.exitCode = 2;
  });
  // Exit 1 is `refuted` and nothing else: anything the named codes do not cover exits 2, never
  // Node's default 1, which a shell caller would read as a verdict.
  main()
    .then((code) => {
      if (!process.exitCode) process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(
        `UNEXPECTED_ERROR - — ${error?.stack ?? error?.message ?? String(error)}\n`,
      );
      process.exitCode = 2;
    });
}
