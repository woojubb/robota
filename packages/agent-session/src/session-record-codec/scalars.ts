/**
 * TRANS-005 (#2081) — the leaf decoders every nested session-record decoder is built from.
 *
 * Each one takes the raw value, the path it sits at, and the issue accumulator; each returns the
 * decoded value or `undefined` after recording why. `undefined` is NOT "the field was absent" — an
 * absent optional member is handled by {@link decodeOptional}, and the caller decides validity by
 * asking whether any issue was recorded, never by testing a return value.
 */

import { addIssue, atIndex, atKey, describeValue } from './decode-outcome.js';

import type { TDecodeIssues } from './decode-outcome.js';
import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { TBackgroundPrimitive } from '@robota-sdk/agent-interface-transport';

/** Decode an optional member: absent stays absent, present is decoded, `null` is a defect. */
export function decodeOptional<TValue>(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
  decode: (value: unknown, path: string, issues: TDecodeIssues) => TValue | undefined,
): TValue | undefined {
  if (value === undefined) return undefined;
  return decode(value, path, issues);
}

export function decodeString(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): string | undefined {
  if (typeof value === 'string') return value;
  addIssue(issues, path, `expected a string, received ${describeValue(value)}`);
  return undefined;
}

export function decodeNumber(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  addIssue(issues, path, `expected a finite number, received ${describeValue(value)}`);
  return undefined;
}

export function decodeInteger(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  addIssue(issues, path, `expected an integer, received ${describeValue(value)}`);
  return undefined;
}

export function decodeBoolean(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): boolean | undefined {
  if (typeof value === 'boolean') return value;
  addIssue(issues, path, `expected a boolean, received ${describeValue(value)}`);
  return undefined;
}

/** Decode a member of a string-literal union, naming the permitted members when it is not one. */
export function decodeLiteral<TLiteral extends string>(
  value: unknown,
  allowed: readonly TLiteral[],
  path: string,
  issues: TDecodeIssues,
): TLiteral | undefined {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as TLiteral;
  }
  addIssue(
    issues,
    path,
    `expected one of ${allowed.join(' | ')}, received ${describeValue(value)}`,
  );
  return undefined;
}

/**
 * Decode a member the contract declares `string` but means as an instant.
 *
 * It stays a string — the contract says so — but must be one a date can be read from, because the
 * session list is ordered by `new Date(updatedAt).getTime()` and an unparseable string sorts as
 * `NaN`, which is an unstable order rather than an error anyone sees.
 *
 * ## The limit, stated because a caller will otherwise over-read it
 *
 * This accepts whatever `Date.parse` accepts, which is wider than ISO-8601: `'2026'` parses, and so
 * do several implementation-defined forms. So the guarantee is exactly "a date can be read from
 * this", NOT "this is a well-formed instant" — a record carrying `'2026'` decodes, and reads back as
 * midnight on the first of January.
 *
 * Tightening it to strict ISO-8601 is deliberately NOT done here: the contract these members belong
 * to declares them `string` and says nothing about their format, and a decoder that refuses a value
 * its own contract permits is inventing a stricter contract than the one it decodes. A consumer that
 * needs a well-formed instant validates for itself; this one guarantees only that ordering by date
 * will not silently produce `NaN`.
 */
export function decodeTimestampString(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): string | undefined {
  if (typeof value !== 'string') {
    addIssue(
      issues,
      path,
      `expected an ISO-8601 timestamp string, received ${describeValue(value)}`,
    );
    return undefined;
  }
  if (Number.isNaN(Date.parse(value))) {
    addIssue(issues, path, 'expected a timestamp a date can be parsed from');
    return undefined;
  }
  return value;
}

/**
 * Decode a member the contract declares `Date`.
 *
 * JSON has no date type, so a persisted `Date` arrives as a string and every consumer that calls a
 * `Date` method on it fails at the call rather than at the load. This is the one place that gap is
 * closed: an ISO-8601 string OR a live `Date` decodes to a `Date`, and nothing else does.
 */
export function decodeDate(value: unknown, path: string, issues: TDecodeIssues): Date | undefined {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      addIssue(issues, path, 'expected a valid Date, received an invalid one');
      return undefined;
    }
    return value;
  }
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value);
  addIssue(
    issues,
    path,
    `expected a Date or an ISO-8601 timestamp string, received ${describeValue(value)}`,
  );
  return undefined;
}

/** Decode an array, decoding each element at its own indexed path. */
export function decodeArray<TItem>(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
  decodeItem: (value: unknown, path: string, issues: TDecodeIssues) => TItem | undefined,
): TItem[] | undefined {
  if (!Array.isArray(value)) {
    addIssue(issues, path, `expected an array, received ${describeValue(value)}`);
    return undefined;
  }
  const decoded: TItem[] = [];
  value.forEach((item, index) => {
    const element = decodeItem(item, atIndex(path, index), issues);
    if (element !== undefined) decoded.push(element);
  });
  return decoded;
}

export function decodeStringArray(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): string[] | undefined {
  return decodeArray(value, path, issues, decodeString);
}

/**
 * Decode an object whose members are DECLARED, rejecting any key the contract does not name.
 *
 * A persisted record is written by this build's own code at a known version, so an unrecognised key
 * means the shape drifted — which is what the envelope version exists to report. Silently ignoring
 * it is how a field goes missing without anyone learning that it did.
 */
export function decodeDeclaredObject(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
  declaredKeys: readonly string[],
): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    addIssue(issues, path, `expected an object, received ${describeValue(value)}`);
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const declared = new Set(declaredKeys);
  for (const key of Object.keys(record)) {
    if (!declared.has(key)) {
      addIssue(issues, atKey(path, key), 'unknown key; the record contract does not declare it');
    }
  }
  return record;
}

/**
 * Decode a map the contract leaves OPEN — `metadata`, `data`, a schema's `properties`.
 *
 * The key set is the author's, not the contract's, so an unrecognised key here is data rather than
 * drift. Only the VALUES are constrained.
 */
export function decodeOpenMap<TValue>(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
  decodeValue: (value: unknown, path: string, issues: TDecodeIssues) => TValue | undefined,
): Record<string, TValue> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    addIssue(issues, path, `expected an object, received ${describeValue(value)}`);
    return undefined;
  }
  const decoded: Record<string, TValue> = {};
  for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
    const element = decodeValue(member, atKey(path, key), issues);
    if (element !== undefined) decoded[key] = element;
  }
  return decoded;
}

/**
 * Decode a value on the universal payload axis.
 *
 * `TUniversalValue` admits `Date`, and inside an open map a persisted date is a string that cannot
 * be told from any other string. Reviving by shape would turn a user's date-like text into a `Date`,
 * so this decoder does not revive: through persistence, that member of the axis is unreachable. A
 * live `Date` handed in from memory is still accepted.
 */
export function decodeUniversalValue(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): TUniversalValue | undefined {
  if (value === null || value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    const decoded: TUniversalValue[] = [];
    value.forEach((item, index) => {
      const element = decodeUniversalValue(item, atIndex(path, index), issues);
      if (element !== undefined) decoded.push(element);
    });
    return decoded;
  }
  if (typeof value === 'object') {
    return decodeOpenMap(value, path, issues, decodeUniversalValue);
  }
  addIssue(issues, path, `expected a JSON-compatible value, received ${describeValue(value)}`);
  return undefined;
}

export function decodeBackgroundPrimitive(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): TBackgroundPrimitive | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  addIssue(issues, path, `expected a string, number or boolean, received ${describeValue(value)}`);
  return undefined;
}
