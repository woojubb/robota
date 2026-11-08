/**
 * `text` as it reads inside a JSON string. A test that captures a log context with
 * `JSON.stringify(context)` finds a Windows path with every backslash doubled, so the expectation has
 * to be escaped the same way to match.
 */
export function inJsonString(text: string): string {
  return JSON.stringify(text).slice(1, -1);
}
