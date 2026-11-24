/** The field checks the definition and offer validators share. Every refusal names the field. */
import { containsSensitiveMemoryContent } from '@robota-sdk/agent-framework';
import { carriesSecretValue } from '@robota-sdk/agent-product/personal';

export class TaskCatalogRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'TaskCatalogRefusedError';
  }
}

/** Control characters and the ones that reorder displayed text have no place in a line shown to a person. */
const UNSAFE_CHARACTER = /[\p{Cc}‎‏‪-‮⁦-⁩]/u;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;

export function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TaskCatalogRefusedError(`${what} must be an object`);
  return value as Record<string, unknown>;
}

/** Refuse a field nobody defined, so a record cannot carry anything the validators did not look at. */
export function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  what: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key))
      throw new TaskCatalogRefusedError(`${what} has an unknown field: ${key}`);
  }
}

/**
 * A line of plain text: whitespace runs, including line breaks, collapse to one space, and what is left
 * has to fit `max`. Nothing is shortened, since a cut sentence says something else.
 */
export function singleLine(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new TaskCatalogRefusedError(`${field} must be text`);
  const line = value.replace(/\s+/gu, ' ').trim();
  if (line === '') throw new TaskCatalogRefusedError(`${field} must not be empty`);
  if (line.length > max)
    throw new TaskCatalogRefusedError(`${field} must be at most ${max} characters`);
  if (UNSAFE_CHARACTER.test(line))
    throw new TaskCatalogRefusedError(`${field} must not contain control characters`);
  return line;
}

/** A line that carries no credential-shaped value, for text that is stored and shown. */
export function plainLine(value: unknown, field: string, max: number): string {
  const line = singleLine(value, field, max);
  if (containsSensitiveMemoryContent(line))
    throw new TaskCatalogRefusedError(`${field} looks like it carries a secret and is not kept`);
  return line;
}

/**
 * A line of plain text for what an observation says about a source, such as a mail about a password
 * reset: judged by the value it carries and not by its vocabulary, so the words "password" or "token"
 * pass and a key, a token or a card number written out does not.
 */
export function valueLine(value: unknown, field: string, max: number): string {
  const line = singleLine(value, field, max);
  if (carriesSecretValue(line))
    throw new TaskCatalogRefusedError(`${field} looks like it carries a secret and is not kept`);
  return line;
}

export function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T))
    throw new TaskCatalogRefusedError(`${field} must be one of ${allowed.join(', ')}`);
  return value as T;
}

export function shaped(value: unknown, field: string, pattern: RegExp, max: number): string {
  if (typeof value !== 'string' || value.length > max || !pattern.test(value))
    throw new TaskCatalogRefusedError(`${field} is not in the expected form`);
  return value;
}

export function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new TaskCatalogRefusedError(`${field} must be a positive whole number`);
  return value;
}

export function isoTime(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ISO_TIME.test(value) || Number.isNaN(Date.parse(value)))
    throw new TaskCatalogRefusedError(`${field} must be a UTC time like 2026-01-31T09:00:00Z`);
  return value;
}

export function listOf(value: unknown, field: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new TaskCatalogRefusedError(`${field} must be a list of ${min} to ${max} entries`);
  return value;
}
