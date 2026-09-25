/**
 * The literal secrets content redaction masks, re-read for every exported batch. Reading them again
 * each time is the point: a `/provider` or preset switch mid-session resolves a credential the
 * startup snapshot never saw, and a newly added settings profile carries one too.
 */
import { homedir } from 'node:os';
import { collectSettingsSecrets } from '@robota-sdk/agent-command';
import {
  inspectSettingsLayers,
  readMergedProviderSettings,
  readProviderSettings,
} from '@robota-sdk/agent-framework';
import type { TSettingsSource, TWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import { resolvePromptHistoryProject } from '../startup/prompt-history-enablement.js';
import type { ILiveContentRedactionContext } from './live-content-redaction.js';

export interface ILiveContentSecretSources {
  /** Every settings layer the session can resolve a provider from (startup and switch sources). */
  readonly settingsSources: readonly TSettingsSource[];
  readonly providerDefinitions: readonly IProviderDefinition[];
  /** Read live, not copied: an ambient key a definition's default names is resolved from here. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Credentials resolved at startup outside the settings layers (for example `--provider`). */
  readonly startupCredentials?: readonly (string | undefined)[];
}

function resolvedKey(
  sources: ILiveContentSecretSources,
  providerOverride: string | undefined,
): string | undefined {
  try {
    return readProviderSettings(sources.settingsSources, {
      providerDefinitions: sources.providerDefinitions,
      env: { ...sources.env },
      ...(providerOverride !== undefined ? { providerOverride } : {}),
    }).apiKey;
  } catch {
    // A profile that cannot be resolved has no credential to mask.
    return undefined;
  }
}

export function createLiveContentSecretsGetter(sources: ILiveContentSecretSources): () => string[] {
  return () => {
    const layers = inspectSettingsLayers(sources.settingsSources).layers.map((layer) => layer.settings);
    const secrets = new Set(collectSettingsSecrets(layers, sources.env));
    const add = (value: string | undefined): void => {
      if (typeof value === 'string' && value.length > 0) secrets.add(value);
    };
    add(resolvedKey(sources, undefined));
    const profiles = Object.keys(readMergedProviderSettings(sources.settingsSources).providers ?? {});
    for (const profile of profiles) add(resolvedKey(sources, profile));
    for (const credential of sources.startupCredentials ?? []) add(credential);
    return [...secrets];
  };
}

/**
 * The CLI's redaction context: the secrets getter above, the working directory and the project
 * root the session resolved, and the user's home. Built for every run; used only when a content
 * gate is on.
 */
export function createCliLiveContentRedaction(inputs: ILiveContentSecretSources & {
  readonly cwd: string;
  readonly projectAccess: TWorkspaceProjectAccess;
}): ILiveContentRedactionContext {
  let projectRoot: string | undefined;
  try {
    projectRoot = resolvePromptHistoryProject(inputs.projectAccess, inputs.cwd);
  } catch {
    // An unresolvable root still leaves the working directory and home masked.
    projectRoot = undefined;
  }
  return {
    getSecrets: createLiveContentSecretsGetter(inputs),
    cwd: inputs.cwd,
    ...(projectRoot !== undefined ? { projectRoot } : {}),
    homedir: homedir(),
  };
}
