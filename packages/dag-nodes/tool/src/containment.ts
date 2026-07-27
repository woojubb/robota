/**
 * SEC-007 — the containment root every builtin the `tool` node runs is bound to.
 *
 * Split out of `index.ts` because deciding a security boundary is a different responsibility from
 * running a node, and a boundary buried in an executor is a boundary nobody reviews.
 */

import { resolve } from 'node:path';

import { isPathInside } from '@robota-sdk/agent-core';
import { buildValidationError, type IDagError, type TResult } from '@robota-sdk/dag-core';

/**
 * Resolve the root, refusing a `config.cwd` that escapes the directory the run was invoked from.
 *
 * The boundary is the invocation directory. That is the same anchor the `file-read` and `file-write`
 * nodes use, and for the same stated reason: `INodeExecutionContext` carries no workspace root, so
 * this makes explicit the boundary the node was already implicitly claiming rather than inventing a
 * new concept. Without it the `tool` node was the way AROUND those two — `toolName: "read"` with an
 * absolute path did what `file-read` refuses.
 *
 * `config.cwd` may only NARROW that root. It comes out of the same LLM-authorable `.dag.json` as the
 * paths it is nominally containing, so honouring it as the boundary would let `{"cwd":"/"}` disarm
 * the guard in one line — a root the attacker supplies is not a root.
 *
 * Decided canonically through agent-core's shared `isPathInside` SSOT, so a `cwd` reached through an
 * escaping symlink is refused too. A lexical check passes `escape/…` when `escape -> /`, because
 * `resolve()` never consults the filesystem; segment validation would not catch it either, since
 * `escape` is a perfectly plain segment.
 */
export function resolveContainmentRoot(
  configCwd: string | undefined,
  nodeId: string,
): TResult<string, IDagError> {
  const invocationRoot = process.cwd();
  if (configCwd === undefined) return { ok: true, value: invocationRoot };

  const requested = resolve(invocationRoot, configCwd);
  if (!isPathInside(invocationRoot, requested)) {
    return {
      ok: false,
      error: buildValidationError(
        'DAG_VALIDATION_TOOL_CWD_OUTSIDE_ROOT',
        `cwd "${configCwd}" resolves outside the working directory`,
        { nodeId },
        {
          action: 'set_config',
          suggestion: 'Set cwd to a directory inside the directory the run was invoked from',
        },
      ),
    };
  }
  return { ok: true, value: requested };
}
