/**
 * The permission rules each settings layer declares, read fresh so `/permissions` names the file a
 * rule lives in as it is now, not as it was at startup (issue #3082).
 */
import { readSettingsLayers } from './settings-inspection.js';

import type { ISettingsDocumentStore } from './settings-store-types.js';
import type { TSettingsSource } from './settings-source.js';
import type {
  ICommandPermissionRulesAdapter,
  IPermissionRuleLayer,
  IPermissionRuleRemoval,
} from '../command-api/host-adapters.js';
import type { TSettingsData } from './settings-io.js';

export function readPermissionRuleLayers(
  sources: readonly TSettingsSource[],
): IPermissionRuleLayer[] {
  const layers: IPermissionRuleLayer[] = [];
  for (const layer of readSettingsLayers(sources)) {
    const permissions = layer.settings?.permissions;
    if (permissions === undefined) continue;
    layers.push({
      source: layer.source.displayName,
      scope: layer.source.scope,
      allow: permissions.allow ?? [],
      deny: permissions.deny ?? [],
      ask: permissions.ask ?? [],
    });
  }
  return layers;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * #3282 §4a: remove one declared pattern from whichever writable `stores` entry matches the
 * removal's `scope` — the same settings document `/permissions` would read the rule from. Returns
 * `false` (writes nothing) when no store matches the scope, or the pattern is not actually present.
 */
export function removePermissionRule(
  stores: readonly ISettingsDocumentStore[],
  removal: IPermissionRuleRemoval,
): boolean {
  const store = stores.find((candidate) => candidate.scope === removal.scope);
  if (!store) return false;
  const settings = store.read();
  const permissions = isPlainObject(settings['permissions']) ? settings['permissions'] : undefined;
  const list = permissions?.[removal.kind];
  if (!Array.isArray(list) || !list.includes(removal.pattern)) return false;
  const nextPermissions: TSettingsData = {
    ...permissions,
    [removal.kind]: list.filter((pattern) => pattern !== removal.pattern),
  };
  store.write({ ...settings, permissions: nextPermissions });
  return true;
}

export function createSettingsPermissionRulesAdapter(
  sources: readonly TSettingsSource[],
  stores?: readonly ISettingsDocumentStore[],
): ICommandPermissionRulesAdapter {
  return {
    readLayers: () => readPermissionRuleLayers(sources),
    ...(stores ? { removeRule: (removal: IPermissionRuleRemoval) => removePermissionRule(stores, removal) } : {}),
  };
}
