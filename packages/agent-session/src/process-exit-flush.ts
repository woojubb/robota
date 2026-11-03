/**
 * The Node host's answer to `IFileSessionLoggerOptions.registerExitFlush`: run `flush` when the
 * process is about to end. `exit` listeners may only do synchronous work, which is what a logger's
 * flush does. Pass this very function to every logger — the logger registers once per distinct
 * function, so one process gets one listener however many loggers it creates.
 */
export function registerProcessExitFlush(flush: () => void): void {
  if (typeof process === 'undefined' || typeof process.on !== 'function') return;
  process.on('exit', flush);
}
