/**
 * What "don't ask again" GRANTS, as a permission pattern (issue #2351).
 *
 * Session and project consent used to be keyed on the tool NAME: approving `Bash` for `git status`
 * allowed every later `Bash`, approving `WebFetch` for one benign URL allowed every host, and the
 * project-level record (`Tool(*)`) outlived the session. The user was shown one argument and
 * granted all of them, and the prompt never said so.
 *
 * The consent record is now a pattern in the gate's own grammar, projected from the argument by the
 * kind the tool's permission profile declares (CORE-049), so the record, the prompt and the
 * `permissions.allow` rules all speak one language and are matched by one matcher:
 *
 * - `path`    → the containing directory: `Read(/w/src/**)` — one approval covers a tree, not a file
 *               and not the filesystem;
 * - `url`     → the origin: `WebFetch(https://example.com/**)` — a host, not every host;
 * - `command` → the program: `Bash(git *)` — `argv[0]`, the projection the issue names;
 * - `text`, or no declared argument → the tool name: a search query or a glob pattern is not a
 *               blast radius, and a tool that declares no argument cannot be narrowed at all.
 *
 * Exact-argument consent would prompt constantly; unbounded consent is what existed. A projection is
 * the design work, and it is stated here once so both prompt surfaces can print it verbatim.
 */

import { getToolPermissionProfile } from '@robota-sdk/agent-core';

import type { TToolArgs } from '@robota-sdk/agent-core';

/** Lexical directory of a path, separators normalised; `/` → `/`, `a` → `.`. */
function directoryOf(path: string): string {
  const slashed = path.replace(/\\/g, '/');
  const cut = slashed.lastIndexOf('/');
  if (cut < 0) return '.';
  if (cut === 0) return '/';
  return slashed.slice(0, cut);
}

/** The pattern text (inside the parentheses) consent covers, or undefined for name-only consent. */
function scopeArgument(kind: string, value: string): string | undefined {
  switch (kind) {
    case 'path': {
      const dir = directoryOf(value);
      return dir === '/' ? '/**' : `${dir}/**`;
    }
    case 'url': {
      try {
        const url = new URL(value);
        return `${url.protocol}//${url.host}/**`;
      } catch {
        // allow-fallback: a URL the platform parser refuses is consented to EXACTLY as written —
        // the strict direction — never widened to the tool name.
        return value;
      }
    }
    case 'command': {
      const argv0 = value.trim().split(/\s+/)[0];
      return argv0 ? `${argv0} *` : undefined;
    }
    default:
      return undefined;
  }
}

/** The permission pattern a "don't ask again" answer for this invocation grants. */
export function consentScopeFor(toolName: string, toolArgs: TToolArgs): string {
  const argument = getToolPermissionProfile(toolName).argument;
  if (argument === undefined) return toolName;
  const value = toolArgs[argument.key];
  if (typeof value !== 'string' || value === '') return toolName;
  const scoped = scopeArgument(argument.kind, value);
  return scoped === undefined ? toolName : `${toolName}(${scoped})`;
}
