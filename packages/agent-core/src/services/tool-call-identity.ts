/** A tool call identity must distinguish an action within its assistant frame. */
export function isValidToolCallIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
