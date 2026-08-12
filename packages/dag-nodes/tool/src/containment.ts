/**
 * SEC-007 — the containment root every builtin the `tool` node runs is bound to.
 *
 * Split out of `index.ts` because deciding a security boundary is a different responsibility from
 * running a node, and a boundary buried in an executor is a boundary nobody reviews.
 */

import { resolve } from 'node:path';

import { isPathInside } from '@robota-sdk/agent-core/node';
import { buildValidationError, type IDagError, type TResult } from '@robota-sdk/dag-core';

/**
 * Resolve the root, refusing a `config.cwd` that escapes the trusted execution root.
 *
 * The authority is `INodeExecutionContext.executionRoot`, selected and canonicalized by the product
 * composition before task admission. Without it the `tool` node was the way AROUND `file-read` and
 * `file-write` — `toolName: "read"` with an absolute path did what those nodes refuse.
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
  executionRoot: string,
  configCwd: string | undefined,
  nodeId: string,
): TResult<string, IDagError> {
  if (configCwd === undefined) return { ok: true, value: executionRoot };

  const requested = resolve(executionRoot, configCwd);
  if (!isPathInside(executionRoot, requested)) {
    return {
      ok: false,
      error: buildValidationError(
        'DAG_VALIDATION_TOOL_CWD_OUTSIDE_ROOT',
        `cwd "${configCwd}" resolves outside the execution root`,
        { nodeId },
        {
          action: 'set_config',
          suggestion: 'Set cwd to a directory inside the trusted execution root',
        },
      ),
    };
  }
  return { ok: true, value: requested };
}
