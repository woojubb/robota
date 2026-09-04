/**
 * Canonicalise a tool invocation's arguments BEFORE the permission gate sees them (issue #2429).
 *
 * `Read`, `Write` and `Edit` declare `filePath` absolute, but nothing makes the model comply. A
 * relative `filePath` reaching the gate as written cannot be compared with an absolute pattern —
 * `Read(/w/**)` against `src/x` — and CORE-049 answers that case "unevaluable" (a deny prompts, an
 * allow does not auto-approve) rather than guessing the base. The base is not a guess here: the
 * session's `cwd` is the containment root the tool itself anchors a relative path to, so resolving
 * against it produces the exact path the tool will open, and the gate judges that.
 *
 * Which argument is a path is what the tool's registered permission profile declares
 * (`argument.kind === 'path'`), so this module names no tool. The canonical parameters are what
 * the gate, the logs and the tool all receive — one input, not one for the decision and another
 * for the action.
 */

import { isAbsolute, resolve } from 'node:path';

import { getToolPermissionProfile } from '@robota-sdk/agent-core';

import type { TToolParameters } from '@robota-sdk/agent-core';

export function canonicaliseToolArguments(
  toolName: string,
  parameters: TToolParameters,
  cwd: string,
): TToolParameters {
  const argument = getToolPermissionProfile(toolName).argument;
  if (argument === undefined || argument.kind !== 'path') return parameters;
  const value = parameters[argument.key];
  if (typeof value !== 'string' || value === '' || isAbsolute(value)) return parameters;
  return { ...parameters, [argument.key]: resolve(cwd, value) };
}
