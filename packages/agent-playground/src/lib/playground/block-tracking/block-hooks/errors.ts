export function toError(value: Error | string): Error {
  return value instanceof Error ? value : new Error(String(value));
}
