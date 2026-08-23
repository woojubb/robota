/**
 * TRANS-005 (#2081) — the outcome vocabulary the session-record decoder answers in.
 *
 * ## Why an outcome and not an exception or `undefined`
 *
 * The defect this codec replaces is a store that answers "is this a valid record?" by returning
 * `undefined`, which its caller then reads as "no such session" and repairs by replaying a partial
 * reconstruction. Corruption and absence became the same answer, and the repair silently dropped
 * fields. A type that cannot spell that confusion is the fix: this outcome distinguishes a value
 * that failed to decode (`corrupt`) from one written by a build this one does not implement
 * (`unsupported`), and deliberately has NO `missing` member.
 *
 * `missing` is a property of a STORE, not of a value — a file that is not there never reaches a
 * decoder. The store composes its own `missing` with these three.
 */

import type {
  IInteractiveSessionRecord,
  ISessionRecordDecodeIssue,
} from '@robota-sdk/agent-interface-session';

/** What a decode of a persisted session record can conclude. */
export type TSessionRecordDecodeOutcome =
  | { readonly status: 'valid'; readonly record: IInteractiveSessionRecord }
  | { readonly status: 'corrupt'; readonly issues: readonly ISessionRecordDecodeIssue[] }
  | { readonly status: 'unsupported'; readonly schemaVersion: number | undefined };

/**
 * Re-stated for readers of this module: `ISessionRecordDecodeIssue` is declared with the record it
 * describes, in the contract package (TRANS-007). The TYPE is a contract; this module owns the
 * MECHANISM that produces it. `scan-interface-runtime` draws exactly that line.
 */

/**
 * The accumulator a decode pass writes into.
 *
 * Every decoder takes it and appends; none of them returns early on the first failure, so one call
 * reports the whole shape of the damage rather than the first symptom of it.
 */
export type TDecodeIssues = ISessionRecordDecodeIssue[];

/** `messages` + `id` → `messages.id`; a root-level key keeps its bare name. */
export function atKey(parent: string, key: string): string {
  return parent.length === 0 ? key : `${parent}.${key}`;
}

/** `messages` + `2` → `messages[2]`. */
export function atIndex(parent: string, index: number): string {
  return `${parent}[${index}]`;
}

export function addIssue(issues: TDecodeIssues, path: string, message: string): void {
  issues.push({ path, message });
}

/**
 * A short, non-throwing description of what was actually found, for the human half of an issue.
 *
 * It names the KIND rather than printing the value: a session record carries prompts and tool
 * output, and an error string is exactly the kind of thing that ends up in a log.
 */
export function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (value instanceof Date) return 'a Date';
  switch (typeof value) {
    case 'undefined':
      return 'nothing';
    case 'string':
      return 'a string';
    case 'number':
      return 'a number';
    case 'boolean':
      return 'a boolean';
    case 'object':
      return 'an object';
    default:
      return `a ${typeof value}`;
  }
}

/**
 * Assign an optional member only when it decoded to a value.
 *
 * Writing `undefined` instead would make an absent member present-and-undefined, which survives
 * `JSON.stringify` as an omission but not as an identity — a decoded record must be the same shape
 * as the one that was persisted, not a wider one.
 */
export function setOptional<TTarget extends object, TKey extends keyof TTarget>(
  target: TTarget,
  key: TKey,
  value: TTarget[TKey] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}
