/**
 * #3282 §4b — the Settings screen's "Providers & Models" list: every configured provider profile,
 * with its provider's plain label, its model's label, whether it is the one in use, and a plain
 * connection state when one is known (only "Key missing" today).
 *
 * Reads the SAME merged settings and provider definitions `buildModelListSnapshot`
 * (`provider-model-catalog.ts`) does, so the two can never disagree about which profiles are
 * configured or what a model's label is — a profile listed here that has no model is exactly the one
 * `buildModelListSnapshot` would skip, so the Settings screen is the one place that can still show it
 * (with `model` absent) and offer fixing it via Edit.
 */

import { findProviderDefinition, getProviderCredentialRequirement, hasUsableSecretReference } from '@robota-sdk/agent-core';

import type { IProviderProfileSettings } from './provider-settings.js';
import type { IProviderDefinition, TProviderCredentialField } from '@robota-sdk/agent-core';
import type { ISettingsProviderProfile, ISettingsProvidersSection } from '@robota-sdk/agent-interface-session';

/** The provider's plain display name — never its internal `type` id, unless nothing else is known. */
function providerLabel(definition: IProviderDefinition | undefined, profile: IProviderProfileSettings): string {
  return definition?.displayName ?? profile.type ?? 'Unknown provider';
}

/** The catalog's display name for a configured model id, falling back to the raw id. */
function modelLabel(modelId: string, definition: IProviderDefinition | undefined): string {
  const catalog = definition?.modelCatalog;
  const entries = catalog !== undefined && catalog.status !== 'unavailable' ? (catalog.entries ?? []) : [];
  return entries.find((entry) => entry.id === modelId)?.displayName ?? modelId;
}

function credentialValue(
  profile: IProviderProfileSettings,
  definition: IProviderDefinition | undefined,
  field: TProviderCredentialField,
): string | undefined {
  const raw = profile[field] ?? definition?.defaults?.[field];
  return typeof raw === 'string' ? raw : undefined;
}

/**
 * "Key missing" when the provider needs a credential (`getProviderCredentialRequirement`) and none
 * of the fields it accepts resolves to a usable value — a plaintext key, or an `$ENV:` reference
 * whose variable is actually set. Absent (never a guess) when the provider needs no credential.
 */
function connectionState(
  profile: IProviderProfileSettings,
  definition: IProviderDefinition | undefined,
  environment: Readonly<Record<string, string | undefined>> | undefined,
): string | undefined {
  const requirement = getProviderCredentialRequirement(definition);
  if (requirement === undefined) return undefined;
  const resolve = environment === undefined ? undefined : (name: string) => environment[name];
  const hasCredential = requirement.anyOf.some((field) =>
    hasUsableSecretReference(credentialValue(profile, definition, field), resolve),
  );
  return hasCredential ? undefined : 'Key missing';
}

/**
 * Every configured profile, in settings order (the Settings screen marks the current one with
 * `current` rather than reordering around it — unlike the model list's current-first order, which
 * exists only to break a same-id tie). `allowedProviders`, when set, is the org policy's allowlist of
 * profile names (`IOrgPolicy.allowedProviders`) — the same filter `buildModelListSnapshot` applies,
 * so Settings never offers managing a profile a switch would then refuse.
 */
export function buildProviderProfilesSnapshot(
  providers: Record<string, IProviderProfileSettings> | undefined,
  currentProfileName: string | undefined,
  providerDefinitions: readonly IProviderDefinition[],
  allowedProviders?: readonly string[],
  /** The map `$ENV:` references resolve against (the host's startup snapshot). */
  environment?: Readonly<Record<string, string | undefined>>,
): ISettingsProvidersSection {
  const all = providers ?? {};
  const profiles: ISettingsProviderProfile[] = [];
  for (const name of Object.keys(all)) {
    if (allowedProviders !== undefined && !allowedProviders.includes(name)) continue;
    const profile = all[name];
    if (profile === undefined) continue;
    const definition =
      typeof profile.type === 'string' ? findProviderDefinition(providerDefinitions, profile.type) : undefined;
    const state = connectionState(profile, definition, environment);
    profiles.push({
      name,
      providerLabel: providerLabel(definition, profile),
      ...(typeof profile.model === 'string' && profile.model.length > 0
        ? { model: { id: profile.model, label: modelLabel(profile.model, definition) } }
        : {}),
      current: name === currentProfileName,
      ...(state !== undefined ? { connectionState: state } : {}),
    });
  }
  return { profiles };
}
