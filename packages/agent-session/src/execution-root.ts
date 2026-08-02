/**
 * The session's execution root. ARCH-010.
 *
 * `Session` used to read `process.cwd()` in its constructor, and that ambient value became the
 * session's identity everywhere it matters — every hook input, `CLAUDE_PROJECT_DIR`, the permission
 * enforcer's root, the persisted record. A session could not be TOLD where it ran, so a subagent ran
 * in its parent's directory rather than its own workspace, while the subagent spawn contract had
 * declared `cwd` required all along.
 *
 * Making it a required TypeScript field is necessary and not sufficient. This package's tsconfig
 * excludes `*.test.ts`, and a JavaScript consumer is not type-checked at all — so without a runtime
 * check the field would simply be `undefined`, and the session would report a root it does not have
 * while everything downstream quietly used nothing. Silence is not success: refuse instead.
 */
export function requireExecutionRoot(cwd: unknown): string {
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new Error(
      'Session requires `cwd`: the absolute path this session executes in (ARCH-010). It feeds ' +
        'every hook input, CLAUDE_PROJECT_DIR, the permission root and the persisted record. Pass ' +
        '`process.cwd()` explicitly if that is genuinely what you mean.',
    );
  }
  return cwd;
}
