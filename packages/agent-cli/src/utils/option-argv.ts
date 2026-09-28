/**
 * The part of argv that can hold options: everything before the first `--`. A scan for a flag reads
 * this, so a prompt after `--` that happens to spell a flag (`--attach`, `--safe-mode`) is text.
 */
export function optionArgv(argv: readonly string[]): readonly string[] {
  const terminator = argv.indexOf('--');
  return terminator === -1 ? argv : argv.slice(0, terminator);
}
