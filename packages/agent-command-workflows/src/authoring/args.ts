/**
 * The argument grammar and dependency seam shared by both natural-language authoring subcommands,
 * `/workflows create` and `/workflows build` (WORKFLOW-005 P3). Named for the shared concern
 * (authoring) rather than for `create`, which merely happened to define them first.
 */
import type { IWorkspaceLayout } from '@robota-sdk/dag-core';
import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';
import type { TSettingsSource } from '@robota-sdk/agent-framework';

import { tokenize, type TParseResult } from '../args.js';

/** Test/composition seam: where the workspace, the provider and the clock come from. */
export interface IWorkflowsAuthoringDeps {
  readonly workspace?: IWorkspaceLayout;
  readonly providerDefinitions?: readonly IProviderDefinition[];
  /** Explicit provider settings layers; project layers require an authority-backed source. */
  readonly settingsSources?: readonly TSettingsSource[];
  /** Override provider resolution (tests inject a stub). Default: the active provider from settings. */
  readonly resolveProvider?: (cwd: string) => IAIProvider;
  /** Model passed to the authoring chat call. Default path resolves it from settings. */
  readonly model?: string;
  /** Override the createdAt timestamp for persisted nodes (tests inject a fixed value). */
  readonly now?: () => string;
}

export interface IParsedAuthoringArgs {
  readonly description: string;
  readonly nameOverride?: string;
  readonly inputs: Record<string, string>;
}

/**
 * Parse authoring args: leading non-flag tokens form the description; then `--input k=v` / `--name`.
 * Unknown flags are rejected rather than silently ignored.
 */
export function parseAuthoringArgs(argStr: string): TParseResult<IParsedAuthoringArgs> {
  const tokens = tokenize(argStr.trim());
  const descriptionParts: string[] = [];
  const inputs: Record<string, string> = {};
  let nameOverride: string | undefined;

  let i = 0;
  // Leading non-flag tokens form the description.
  while (i < tokens.length && !tokens[i]!.startsWith('--')) {
    descriptionParts.push(tokens[i]!);
    i += 1;
  }
  while (i < tokens.length) {
    const flag = tokens[i]!;
    if (flag === '--input') {
      const pair = tokens[i + 1];
      if (pair === undefined || pair.startsWith('--')) {
        return { ok: false, error: '--input requires a key=value argument.' };
      }
      const eq = pair.indexOf('=');
      if (eq <= 0) {
        return { ok: false, error: `--input must be key=value, got "${pair}".` };
      }
      inputs[pair.slice(0, eq)] = pair.slice(eq + 1);
      i += 2;
    } else if (flag === '--name') {
      const next = tokens[i + 1];
      if (next === undefined || next.startsWith('--')) {
        return { ok: false, error: '--name requires a value.' };
      }
      nameOverride = next;
      i += 2;
    } else {
      return { ok: false, error: `Unexpected flag: ${flag}` };
    }
  }

  const description = descriptionParts.join(' ').trim();
  if (description === '') {
    return { ok: false, error: 'A natural-language description is required.' };
  }
  return { ok: true, value: { description, ...(nameOverride ? { nameOverride } : {}), inputs } };
}
