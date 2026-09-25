/**
 * The execution root a spawning tool hands its child, never the process directory (issue #3081).
 *
 * `process.cwd()` was the fallback for a tool built without a root. Once a session can move its root,
 * the process directory is where the host happened to start, not where the session is — so a missing
 * root is an assembly bug to report, not a default to fill in (the same rule ARCH-010 set for the
 * file tools).
 */
export function requireToolExecutionRoot(cwd: string | undefined, toolName: string): string {
  if (cwd === undefined) {
    throw new Error(
      `${toolName} tool has no execution root: it was constructed without a \`cwd\`. This is an ` +
        'assembly bug — the child would otherwise run wherever the host process was started.',
    );
  }
  return cwd;
}
