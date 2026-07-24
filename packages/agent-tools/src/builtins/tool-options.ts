/**
 * Shared factory options for the builtin tools (NEUT-002).
 *
 * Builtin tool descriptions are a model-facing contract (see docs/SPEC.md — "Tool Descriptions").
 * The library ships neutral, mechanism-only default text; a consumer that wants product- or
 * deployment-specific guidance overrides the description at the composition root instead of the
 * library hardcoding someone's workflow policy.
 */

import type { ISandboxToolOptions } from '../sandbox/types.js';

/** Options every builtin tool factory accepts: override the model-facing description. */
export interface IBuiltinToolDescriptionOptions {
  /** Replaces the default model-facing description verbatim when provided. */
  description?: string;
}

/** Options for builtin factories that also operate on the sandbox/host filesystem. */
export interface ISandboxBuiltinToolOptions
  extends ISandboxToolOptions, IBuiltinToolDescriptionOptions {}
