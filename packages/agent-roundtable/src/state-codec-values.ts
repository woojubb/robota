import { RoundtableError } from './errors';

export function requireState(condition: unknown): asserts condition {
  if (!condition)
    throw new RoundtableError(
      'invalid-config',
      'Stored conversation state is invalid or incompatible',
    );
}

export function record(value: unknown): Record<string, unknown> {
  requireState(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

export function list(value: unknown): unknown[] {
  requireState(Array.isArray(value));
  return value;
}
export function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
export function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}
export function unique(values: unknown[]): void {
  requireState(values.every(text) && new Set(values).size === values.length);
}
export function reference(value: unknown): void {
  const ref = record(value);
  requireState(text(ref.id) && text(ref.version));
}
export function checkpoint(value: unknown): void {
  if (value === null) return;
  const saved = record(value);
  requireState(text(saved.version) && Object.hasOwn(saved, 'data'));
}
