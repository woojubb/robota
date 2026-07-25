import { isPathInside } from '@robota-sdk/agent-core';

import type { IToolInvocationResult } from '../types/tool-result.js';

/**
 * Returns a JSON-serialized IToolInvocationResult error when filePath is outside cwd.
 * Returns undefined when the path is within cwd or cwd is not set.
 *
 * SEC-006: containment is decided on the CANONICAL (symlink-resolved) paths, via the shared
 * `isPathInside` SSOT in agent-core. A purely lexical `resolve()` + `startsWith` comparison let
 * `<cwd>/link/secret` through when `link -> /etc`, because `resolve` does not consult the filesystem
 * and so cannot see a symlink — while the subsequent `readFile`/`writeFile` followed the link out of
 * the sandbox. For `Write`/`Edit` that meant creating files anywhere the process could reach, and
 * since symlinks are ordinary committed git content, pointing the agent at an untrusted clone was
 * enough to arm it.
 *
 * The same defect existed in the CLI's monitor asset server; both now share one implementation,
 * because two containment checks that can disagree are their own defect.
 */
/**
 * Whether a host path is inside the tool's containment root — the single predicate every builtin
 * asks, whatever it does with the answer.
 *
 * `checkPathWithinCwd` turns a `false` into the tool-result error a tool RETURNS; the enumerating
 * tools (`Glob`, `Grep`) instead SKIP the entry mid-walk and must not fabricate an error per file.
 * Both ask this one question, which asks agent-core's `isPathInside` SSOT — so there is no second
 * containment rule that could disagree with the first (SEC-006's stated defect, SEC-007 keeping it
 * true as the guard's reach widens).
 *
 * `cwd === undefined` means no containment root is configured and the guard is DISARMED — see
 * `pack-coding`'s `ICodingPackOptions.cwd`, which is required precisely so that cannot happen by
 * accident.
 */
export function isWithinCwd(filePath: string, cwd: string | undefined): boolean {
  if (cwd === undefined) return true;
  return isPathInside(cwd, filePath);
}

export function checkPathWithinCwd(filePath: string, cwd: string | undefined): string | undefined {
  if (cwd === undefined) return undefined;

  if (!isWithinCwd(filePath, cwd)) {
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: `Access denied: "${filePath}" is outside the working directory`,
    };
    return JSON.stringify(result);
  }

  return undefined;
}
