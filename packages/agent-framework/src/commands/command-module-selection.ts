import type { ICommandModule, IUnknownCommandModuleName } from '../command-api/index.js';

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

/**
 * Detect preset `enabled`/`disabled` command-module names that match no available module name. Pure.
 *
 * Returns one `{ name, kind }` entry per `enabled`/`disabled` name that is NOT in `availableNames`
 * (`kind` records which list the name came from); `[]` when every name matches. This is the single
 * source of the detection reused by both preset entry points (INFRA-032): the startup `--preset`
 * path (via `createDefaultCommandModules`) and the in-session `/preset` path (via
 * `SessionSkillRouter.reapplyCommandModuleSelection`). An unmatched name — a short form like
 * `"editor"` instead of `agent-command-editor`, or a typo — is surfaced as a non-fatal notice rather
 * than silently dropped.
 */
export function findUnknownModuleNames(
  availableNames: readonly string[],
  enabled?: readonly string[],
  disabled?: readonly string[],
): readonly IUnknownCommandModuleName[] {
  const available = new Set(availableNames);
  const unknown: IUnknownCommandModuleName[] = [];
  for (const name of enabled ?? []) {
    if (!available.has(name)) unknown.push({ name, kind: 'enabled' });
  }
  for (const name of disabled ?? []) {
    if (!available.has(name)) unknown.push({ name, kind: 'disabled' });
  }
  return unknown;
}
