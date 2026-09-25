import { setGlobalLoggerSink } from '@robota-sdk/agent-core';

/**
 * CORE-029 / NEUT-010: the runtime's diagnostics have a destination in this product.
 *
 * `agent-core` defaults to a silent sink and nothing in the repository installed one, so every
 * diagnostic it emits went nowhere — including "no metadata registered for model X, using another
 * vendor's default". Adding the WARNING without connecting a sink would have left the defect exactly
 * where it was while claiming it was fixed; review of #1595 said so, correctly.
 *
 * STDERR, not stdout: the TUI owns stdout, and this process already writes its own errors to stderr.
 * The global level defaults to `warn`, so this carries warnings and errors and stays out of the way
 * of normal output — the same 30 warn and 23 error sites that were unreachable a moment ago.
 */
export function installCliDiagnostics(): void {
  setGlobalLoggerSink({
    debug: () => {},
    info: () => {},
    log: () => {},
    group: () => {},
    groupEnd: () => {},
    warn: (...args) => writeDiagnostic(args),
    error: (...args) => writeDiagnostic(args),
  });
}

/**
 * `console.error`, not a raw stderr write: while the TUI is mounted, Ink intercepts the console and
 * prints the line above its frame. A raw write lands inside the live frame and corrupts the prompt.
 */
function writeDiagnostic(args: unknown[]): void {
  // eslint-disable-next-line no-console -- the console is the channel Ink knows how to render around
  console.error(`[robota] ${formatDiagnostic(args)}`);
}

function formatDiagnostic(args: unknown[]): string {
  return args
    .map(formatArg)
    .filter((text) => text.length > 0)
    .join(' ');
}

/** The logger passes structured context as a trailing object; `String()` would print `[object Object]`. */
function formatArg(arg: unknown): string {
  if (arg instanceof Error) return arg.stack ?? arg.message;
  if (typeof arg !== 'object' || arg === null) return String(arg);
  const entries = Object.entries(arg);
  if (entries.length === 0) return '';
  return entries.map(([key, value]) => `${key}=${formatValue(value)}`).join(' ');
}

/** Never throws: a diagnostic that cannot be printed must not become a new failure. */
function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // allow-fallback: circular or BigInt values have no JSON form; their string form still says something
    return String(value);
  }
}
