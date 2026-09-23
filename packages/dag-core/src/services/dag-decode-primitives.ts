/**
 * Field-path decode primitives shared by every DAG decoder (issue #2077).
 *
 * A decoder here is TOTAL: it reads an `unknown` and either produces a value whose type is honest or
 * a list of `{ path, message }` issues naming exactly which field was wrong. Nothing is cast onward
 * on a top-level discriminator alone, which is how a parseable file used to reach the semantic
 * validator and fail there as a `TypeError`.
 */

import type { IDagError } from '../types/error.js';
import { buildValidationError } from '../utils/error-builders.js';

/** One malformed field, addressed by its JSON path (e.g. `nodes[2].config`). */
export interface IDagDecodeIssue {
  readonly path: string;
  readonly message: string;
}

/** Mutable issue sink threaded through one decode pass. */
export type TDagDecodeIssues = IDagDecodeIssue[];

/** The decoded value, or `undefined` once an issue for it has been recorded. */
export type TDecoded<TValue> = TValue | undefined;

export function pushIssue(issues: TDagDecodeIssues, path: string, message: string): undefined {
  issues.push({ path, message });
  return undefined;
}

export function childPath(parent: string, key: string | number): string {
  return typeof key === 'number' ? `${parent}[${key}]` : parent === '' ? key : `${parent}.${key}`;
}

/** A plain JSON object — arrays and `null` are rejected, since both satisfy `typeof === 'object'`. */
export function decodeRecord(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return pushIssue(issues, path, `expected an object, got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

export function decodeString(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<string> {
  return typeof value === 'string'
    ? value
    : pushIssue(issues, path, `expected a string, got ${describe(value)}`);
}

export function decodeNumber(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<number> {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : pushIssue(issues, path, `expected a finite number, got ${describe(value)}`);
}

export function decodeBoolean(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<boolean> {
  return typeof value === 'boolean'
    ? value
    : pushIssue(issues, path, `expected a boolean, got ${describe(value)}`);
}

export function decodeLiteral<TLiteral extends string>(
  value: unknown,
  members: readonly TLiteral[],
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<TLiteral> {
  if (typeof value === 'string' && (members as readonly string[]).includes(value)) {
    return value as TLiteral;
  }
  return pushIssue(
    issues,
    path,
    `expected one of ${members.map((m) => `'${m}'`).join(', ')}, got ${describe(value)}`,
  );
}

/** Decode `value` when present; absence (`undefined`) is not an issue. */
export function decodeOptional<TValue>(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
  decode: (value: unknown, path: string, issues: TDagDecodeIssues) => TDecoded<TValue>,
): TDecoded<TValue> {
  return value === undefined ? undefined : decode(value, path, issues);
}

export function decodeArray<TItem>(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
  decodeItem: (item: unknown, path: string, issues: TDagDecodeIssues) => TDecoded<TItem>,
): TDecoded<TItem[]> {
  if (!Array.isArray(value)) {
    return pushIssue(issues, path, `expected an array, got ${describe(value)}`);
  }
  const before = issues.length;
  const items = value.map((item, index) => decodeItem(item, childPath(path, index), issues));
  return issues.length === before ? (items as TItem[]) : undefined;
}

export function decodeStringArray(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<string[]> {
  return decodeArray(value, path, issues, decodeString);
}

/** Human-readable description of a wrong value, without echoing large payloads. */
export function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string')
    return `string '${value.length > 40 ? `${value.slice(0, 40)}…` : value}'`;
  return typeof value;
}

/** Render issues as one operator-facing line list. */
export function formatDagDecodeIssues(issues: readonly IDagDecodeIssue[]): string {
  return issues
    .map((issue) => `${issue.path === '' ? '$' : issue.path}: ${issue.message}`)
    .join('; ');
}

/** Fold decode issues into the DAG error shape every port already speaks. */
export function dagDecodeIssuesToError(
  code: string,
  message: string,
  issues: readonly IDagDecodeIssue[],
  context: Record<string, string | number | boolean> = {},
): IDagError {
  return buildValidationError(code, `${message}: ${formatDagDecodeIssues(issues)}`, {
    ...context,
    issueCount: issues.length,
    firstIssuePath: issues[0]?.path ?? '',
  });
}
