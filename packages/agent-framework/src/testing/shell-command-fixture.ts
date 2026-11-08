import { resolvePlatformShell } from '@robota-sdk/agent-core/node';

/**
 * Commands a test hands to the Shell tool or to a command hook, spelled for the shell the platform
 * resolves: a POSIX shell on Linux and macOS, PowerShell on Windows. A POSIX line such as
 * `echo text > file` or `echo text >&2` is not a PowerShell line, and the two disagree in ways that
 * still produce output, so a test cannot rely on a command it never saw fail.
 *
 * Every argument is put in single quotes and so may not contain one.
 */
function quoted(value: string): string {
  if (value.includes("'")) {
    throw new Error('A shell fixture quotes its arguments and cannot carry a single quote.');
  }
  return `'${value}'`;
}

function isPowerShell(): boolean {
  return resolvePlatformShell().kind === 'powershell';
}

/**
 * Writes `text` to `file`, with no trailing newline. PowerShell's `>` writes UTF-16 with a
 * byte-order mark, so a test that reads the file back as UTF-8 finds garbage; PowerShell gets the
 * .NET writer instead, which writes UTF-8 without a mark.
 */
export function writeTextCommand(file: string, text: string): string {
  return isPowerShell()
    ? `[System.IO.File]::WriteAllText(${quoted(file)}, ${quoted(text)})`
    : `printf '%s' ${quoted(text)} > ${quoted(file)}`;
}

/**
 * Writes `message` to standard error. PowerShell 5.1 parses neither `>&2` nor `1>&2`, so it goes
 * through the console's error writer.
 */
export function stderrCommand(message: string): string {
  return isPowerShell()
    ? `[Console]::Error.WriteLine(${quoted(message)})`
    : `echo ${quoted(message)} >&2`;
}

/** What a hook runs to deny an event: `message` on standard error, then exit code 2. */
export function denyCommand(message: string): string {
  return `${stderrCommand(message)}; exit 2`;
}
