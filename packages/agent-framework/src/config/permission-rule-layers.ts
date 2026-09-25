/**
 * The permission rules each settings layer declares, read fresh so `/permissions` names the file a
 * rule lives in as it is now, not as it was at startup (issue #3082).
 */
import { readSettingsLayers } from './settings-inspection.js';

import type { TSettingsSource } from './settings-source.js';
import type {
  ICommandPermissionRulesAdapter,
  IPermissionRuleLayer,
} from '../command-api/host-adapters.js';

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

export function createSettingsPermissionRulesAdapter(
  sources: readonly TSettingsSource[],
): ICommandPermissionRulesAdapter {
  return { readLayers: () => readPermissionRuleLayers(sources) };
}
