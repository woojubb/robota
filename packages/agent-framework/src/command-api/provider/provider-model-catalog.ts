/**
 * #3282 §2 — the model list a person can switch to, and resolving `/model <id>` against it.
 *
 * One function builds the list; the `/model` command (agent-command) and the session's
 * `listModels()` wire projection (InteractiveSession) both call it with their own settings/session
 * inputs, so the TUI picker, the `list-models` wire response and the id a person types all agree on
 * exactly the same models — never three separately-scraped lists.
 *
 * Only CONFIGURED profiles are ever listed (ARCH-PROVIDER-003 `modelCatalog` is descriptive, not an
 * offer to run): a model with no profile behind it cannot appear here, so nothing offered can fail to
 * run for lacking a profile.
 */

import { findProviderDefinition } from '@robota-sdk/agent-core';

import type { IProviderProfileSettings } from './provider-settings.js';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { IModelCatalogEntry, IModelListGroup, IModelListSnapshot } from '@robota-sdk/agent-interface-session';

/** The provider's plain display name — never its internal `type` id, unless nothing else is known. */
function providerLabel(definition: IProviderDefinition | undefined, profile: IProviderProfileSettings): string {
  return definition?.displayName ?? profile.type ?? 'Unknown provider';
}

/**
 * One profile's offered models: its provider's catalog entries when the catalog has any, otherwise
 * just the profile's own configured model (a `status: 'unavailable'` catalog, or one with no
 * `entries`, is the provider declaring it has nothing more specific to offer).
 *
 * The profile's configured model is always present in the result, even when the catalog's entries do
 * not happen to list it — the current model must always be markable, and a model no longer in a
 * refreshed catalog must not silently disappear from what the profile offers.
 */
function modelsForProfile(
  profile: IProviderProfileSettings,
  definition: IProviderDefinition | undefined,
): IModelCatalogEntry[] {
  const catalog = definition?.modelCatalog;
  const catalogEntries =
    catalog !== undefined && catalog.status !== 'unavailable' ? (catalog.entries ?? []) : [];
  const entries: IModelCatalogEntry[] = catalogEntries.map((entry) => ({
    id: entry.id,
    label: entry.displayName,
  }));
  if (typeof profile.model === 'string' && profile.model.length > 0) {
    if (!entries.some((entry) => entry.id === profile.model)) {
      entries.push({ id: profile.model, label: profile.model });
    }
  }
  return entries;
}

/** Order profiles current-first, then the rest in their settings order — never alphabetical. */
function orderedProfileNames(
  providers: Record<string, IProviderProfileSettings>,
  currentProfileName: string | undefined,
): string[] {
  const names = Object.keys(providers);
  if (currentProfileName === undefined || !names.includes(currentProfileName)) return names;
  return [currentProfileName, ...names.filter((name) => name !== currentProfileName)];
}

/**
 * The models every configured profile offers, current profile first (#3282 §2). A profile missing
 * `type` or `model` is skipped — it could not run even by an explicit `/provider switch`, so `/model`
 * does not offer it either. `allowedProviders`, when set, is the org policy's allowlist of provider
 * PROFILE NAMES (`IOrgPolicy.allowedProviders`) — a profile it excludes is skipped the same way, so
 * a control built from this snapshot never offers a switch org policy would then refuse.
 */
export function buildModelListSnapshot(
  providers: Record<string, IProviderProfileSettings> | undefined,
  currentProfileName: string | undefined,
  currentModel: string,
  providerDefinitions: readonly IProviderDefinition[],
  allowedProviders?: readonly string[],
): IModelListSnapshot {
  const all = providers ?? {};
  const groups: IModelListGroup[] = [];
  for (const profileName of orderedProfileNames(all, currentProfileName)) {
    if (allowedProviders !== undefined && !allowedProviders.includes(profileName)) continue;
    const profile = all[profileName];
    if (profile === undefined || !profile.type || !profile.model) continue;
    const definition = findProviderDefinition(providerDefinitions, profile.type);
    groups.push({
      profileName,
      providerLabel: providerLabel(definition, profile),
      models: modelsForProfile(profile, definition),
    });
  }
  return {
    groups,
    ...(currentProfileName !== undefined ? { currentProfile: currentProfileName } : {}),
    currentModel,
  };
}

/** Where an `id` resolves: which profile offers it, and its display label. Group order IS the tie-break. */
export interface IModelListSelection {
  readonly profileName: string;
  readonly model: IModelCatalogEntry;
}

/**
 * Resolve a typed/clicked model id against the snapshot. Groups are already ordered current-profile
 * first, so the first match found — never a special case here — is the one the current profile's
 * provider offers, matching the "prefer the current profile" rule for an id offered by more than one.
 */
export function resolveModelListSelection(
  snapshot: IModelListSnapshot,
  id: string,
): IModelListSelection | undefined {
  for (const group of snapshot.groups) {
    const model = group.models.find((entry) => entry.id === id);
    if (model !== undefined) return { profileName: group.profileName, model };
  }
  return undefined;
}
