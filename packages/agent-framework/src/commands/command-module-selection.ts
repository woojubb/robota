import type { ICommandModule } from '../command-api/index.js';

/**
 * Filter command modules by allow (`enabled`) then deny (`disabled`) name lists. Pure.
 *
 * Rules: if `enabled` is provided, keep only modules whose `name` is in it; then remove any module
 * whose `name` is in `disabled` (deny > allow). Neither given → the input set is returned unchanged.
 *
 * This is the framework-owned counterpart of agent-command's `applyModuleSelection` — duplicated
 * here deliberately so agent-framework does not depend on agent-command (PRESET-015).
 */
export function selectCommandModules(
  modules: readonly ICommandModule[],
  enabled: readonly string[] | undefined,
  disabled: readonly string[] | undefined,
): readonly ICommandModule[] {
  let selected = modules;
  if (enabled !== undefined) {
    const allow = new Set(enabled);
    selected = selected.filter((module) => allow.has(module.name));
  }
  if (disabled !== undefined) {
    const deny = new Set(disabled);
    selected = selected.filter((module) => !deny.has(module.name));
  }
  return selected;
}
