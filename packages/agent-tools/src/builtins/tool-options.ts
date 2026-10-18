/**
 * Shared factory options for the builtin tools (NEUT-002).
 *
 * Builtin tool descriptions are a model-facing contract (see docs/SPEC.md — "Tool Descriptions").
 * The library ships neutral, mechanism-only default text; a consumer that wants product- or
 * deployment-specific guidance overrides the description at the composition root instead of the
 * library hardcoding someone's workflow policy.
 */

import type { IEditorFileOptions } from './editor-files.js';
import type { ISandboxToolOptions } from '../sandbox/types.js';

/** Options every builtin tool factory accepts: override the model-facing description. */
export interface IBuiltinToolDescriptionOptions {
  /** Replaces the default model-facing description verbatim when provided. */
  description?: string;
}

/**
 * Options for a builtin that touches the host filesystem WITHOUT a sandbox seam (SEC-007).
 *
 * `Glob` and `Grep` enumerate; they have no provider-sandbox mode to route through, so a containment
 * root is the only boundary they can have. Splitting this out of {@link ISandboxBuiltinToolOptions}
 * keeps them from advertising a `sandboxClient` they would silently ignore.
 */
export interface IContainedBuiltinToolOptions
  extends IBuiltinToolDescriptionOptions, IEditorFileOptions {
  /**
   * The directory the tool's filesystem access is confined to. REQUIRED — ARCH-010. An out-of-root
   * search root is refused, no entry whose CANONICAL path escapes the root is enumerated, and relative
   * paths the model supplies resolve against this root rather than `process.cwd()`.
   *
   * Required rather than optional because the guard used to be fail-open when it was absent, so
   * omitting it produced an unbounded enumerator rather than an error.
   */
  cwd: string;
}

/** Options for builtin factories that also operate on the sandbox/host filesystem. */
export interface ISandboxBuiltinToolOptions
  extends ISandboxToolOptions, IBuiltinToolDescriptionOptions {}

/**
 * Options for the file tools (`Read`, `Write`, `Edit`). On the host they can hand the access itself
 * to an editor; on a sandbox's own filesystem the sandbox carries it and the editor is not asked.
 */
export interface IFileBuiltinToolOptions extends ISandboxBuiltinToolOptions, IEditorFileOptions {}
