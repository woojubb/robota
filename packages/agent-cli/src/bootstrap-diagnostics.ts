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
    warn: (...args) => process.stderr.write(`[robota] ${formatDiagnostic(args)}\n`),
    error: (...args) => process.stderr.write(`[robota] ${formatDiagnostic(args)}\n`),
  });
}

function formatDiagnostic(args: unknown[]): string {
  return args
    .map((arg) => (arg instanceof Error ? (arg.stack ?? arg.message) : String(arg)))
    .join(' ');
}
