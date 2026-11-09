/**
 * The absolute node binary reaches the child through the task env, not the command text: the command
 * stays a literal and the shell expands the variable. Absolute still matters — the PATH-hijack case
 * replaces PATH, so a bare `node` would not resolve.
 */
export const NODE_BINARY_ENV = 'PRODUCT_TEST_NODE';

/**
 * Command text that runs `script` under node in the shell the runner resolves for this platform:
 * `sh` on POSIX and PowerShell on Windows. The Windows form carries the script as base64 so no
 * quote or `$` in it reaches PowerShell's parser.
 */
export function nodeCommand(script: string): string {
  if (process.platform !== 'win32') return `"$${NODE_BINARY_ENV}" -e ${JSON.stringify(script)}`;
  const encoded = Buffer.from(script, 'utf8').toString('base64');
  return `& $env:${NODE_BINARY_ENV} -e "eval(Buffer.from('${encoded}','base64').toString())"`;
}
