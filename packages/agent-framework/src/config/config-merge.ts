/**
 * Settings-layer composition: how a later layer combines with an earlier one.
 *
 * Split out of `config-loader.ts` by CONFIG-003. The loader's job is to READ layers and RESOLVE the
 * result; deciding what a later layer may do to an earlier one is a different question, and it is
 * the one with a security boundary in it — `mergeHooks` is why a project cannot delete a user's
 * guard. Keeping that decision in a file named for it means the next reader of "can a project
 * override X" has somewhere to look.
 */

import type { TEnvResolvedSettings } from './config-types.js';

/**
 * Deep-merge settings objects. Later entries in the array win.
 *
 * Arrays are replaced (not concatenated) so that project settings fully override user settings for
 * list-type fields — with ONE exception, stated here because the previous version of this comment
 * described two behaviours and the function performed three.
 *
 * **`hooks` is merged per event, never replaced (CONFIG-003).** It is not a list-type field: it is an
 * object keyed by lifecycle event, so it fell through the top-level spread and neither documented
 * rule covered it. A project settings layer declaring one `PostToolUse` hook therefore deleted
 * every user-global hook, including `PreToolUse` security guards — a lower-trust layer
 * silently removing a higher-trust control. The layers are user-then-project, so concatenating each
 * event's groups in layer order keeps the user's guards present and first; `runHooks` returns on the
 * first `deny`, so a surviving guard still blocks whatever a later group would have permitted.
 *
 * A project layer can therefore ADD hooks and can never REMOVE one it did not declare.
 *
 * **A deliberate disable is order-scoped (issue #2320).** A layer's `disabledHooks` names hook-group
 * `id`s, and it removes only groups declared by LATER layers — the ones below it in trust, since the
 * layers are read user-then-project. So a user layer can turn off a named project hook, and a
 * project layer naming a user's guard changes nothing: the guard was merged before the disable was
 * read. Groups without an `id` cannot be named and so cannot be disabled. The set of disabled ids
 * accumulates across layers (a later layer cannot un-disable an earlier layer's decision).
 */
export function mergeSettings(layers: TEnvResolvedSettings[]): TEnvResolvedSettings {
  const disabledHookIds = new Set<string>();
  return layers.reduce<TEnvResolvedSettings>((merged, layer) => {
    const layerHooks = withoutDisabledGroups(layer.hooks, disabledHookIds);
    for (const id of layer.disabledHooks ?? []) disabledHookIds.add(id);
    return {
      ...merged,
      ...layer,
      disabledHooks: disabledHookIds.size > 0 ? [...disabledHookIds] : undefined,
      provider:
        merged.provider !== undefined || layer.provider !== undefined
          ? { ...merged.provider, ...layer.provider }
          : undefined,
      permissions:
        merged.permissions !== undefined || layer.permissions !== undefined
          ? {
              // `allow` REPLACES: an allowlist states the complete permitted set, so a later, more
              // specific layer supersedes the earlier answer. Unchanged — this already conformed.
              allow: layer.permissions?.allow ?? merged.permissions?.allow,
              // `deny` UNIONS: a denial is not weakened by a later layer that forgot to repeat it.
              deny: unionDeny(merged.permissions?.deny, layer.permissions?.deny),
            }
          : undefined,
      env: {
        ...(merged.env ?? {}),
        ...(layer.env ?? {}),
      },
      providers:
        merged.providers !== undefined || layer.providers !== undefined
          ? mergeProviders(merged.providers, layer.providers)
          : undefined,
      enabledPlugins:
        merged.enabledPlugins !== undefined || layer.enabledPlugins !== undefined
          ? { ...(merged.enabledPlugins ?? {}), ...(layer.enabledPlugins ?? {}) }
          : undefined,
      extraKnownMarketplaces: layer.extraKnownMarketplaces ?? merged.extraKnownMarketplaces,
      autoCompactThreshold: layer.autoCompactThreshold ?? merged.autoCompactThreshold,
      hooks:
        merged.hooks !== undefined || layerHooks !== undefined
          ? mergeHooks(merged.hooks, layerHooks)
          : undefined,
      taskContext:
        merged.taskContext !== undefined || layer.taskContext !== undefined
          ? { ...merged.taskContext, ...layer.taskContext }
          : undefined,
    };
  }, {});
}

/**
 * Merge two hooks objects by event, keeping the earlier layer's groups first.
 *
 * **The same operation already existed one module away.** `plugin-hooks-merger.ts`'s
 * `mergeHooksIntoConfig` composes plugin hooks with config hooks by concatenating per event, and has
 * done so all along. Settings-layer hooks were the only hook composition in this package that
 * replaced instead of merging — the codebase knew the answer and this path did not use it.
 *
 * It is not reused directly: that helper is typed against a loose local `IHookGroup` and orders
 * plugin groups first by design, where this needs `THooksConfig` and the user's layer first.
 *
 * Concatenation rather than replacement is the whole security property: the earlier layer is the
 * user's, and a hook it declared must still be there after a later layer adds its own. Duplicates
 * are kept and both run — a repeated guard costs an extra execution, while dropping one on a
 * key-collision guess would be this defect again in a smaller form.
 */
function mergeHooks(
  base: TEnvResolvedSettings['hooks'],
  override: TEnvResolvedSettings['hooks'],
): TEnvResolvedSettings['hooks'] {
  const result: NonNullable<TEnvResolvedSettings['hooks']> = { ...(base ?? {}) };
  for (const [event, groups] of Object.entries(override ?? {})) {
    if (groups === undefined) continue;
    const key = event as keyof NonNullable<TEnvResolvedSettings['hooks']>;
    const existing = result[key];
    result[key] = existing === undefined ? [...groups] : [...existing, ...groups];
  }
  return result;
}

/**
 * Combine two denylists.
 *
 * **This is not a new rule — it is the repository's rule, applied at the one site that disagreed.**
 * `agent-core`'s `applyPresetToolLists` states and implements it for the preset layer:
 *
 * > the allowlist REPLACES … the denylist UNIONS — a denial is not weakened by a later layer that
 * > forgot to repeat it.
 *
 * `permission-enforcer.ts` cites the same rule when it explains why a newly applied denial outranks
 * an earlier "always allow", and ARCH-040's record calls it settled. Settings-layer merging was the
 * exception: `layer.permissions?.deny ?? merged.permissions?.deny` meant a project layer declaring
 * ANY deny silently dropped every deny the user had configured — the lower-trust layer relaxing the
 * higher-trust policy, which is the trust direction inverted.
 *
 * Unlike the `hooks` defect this file was created for, that line was written on purpose rather than
 * falling out of a spread. What makes it wrong is not that nobody decided it, but that the decision
 * contradicts the one the repository had already made elsewhere.
 *
 * Deduplicated and order-preserving, matching `applyPresetToolLists`.
 */
function unionDeny(
  base: readonly string[] | undefined,
  layer: readonly string[] | undefined,
): string[] | undefined {
  if (base === undefined) return layer === undefined ? undefined : [...layer];
  if (layer === undefined) return [...base];
  return [...new Set([...base, ...layer])];
}

/** This layer's hooks minus the groups an EARLIER layer disabled by id (issue #2320). */
function withoutDisabledGroups(
  hooks: TEnvResolvedSettings['hooks'],
  disabledIds: ReadonlySet<string>,
): TEnvResolvedSettings['hooks'] {
  if (hooks === undefined || disabledIds.size === 0) return hooks;
  const result: NonNullable<TEnvResolvedSettings['hooks']> = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (groups === undefined) continue;
    const key = event as keyof NonNullable<TEnvResolvedSettings['hooks']>;
    result[key] = groups.filter((group) => group.id === undefined || !disabledIds.has(group.id));
  }
  return result;
}

function mergeProviders(
  base: TEnvResolvedSettings['providers'],
  override: TEnvResolvedSettings['providers'],
): TEnvResolvedSettings['providers'] {
  const result: NonNullable<TEnvResolvedSettings['providers']> = { ...(base ?? {}) };
  for (const [name, profile] of Object.entries(override ?? {})) {
    result[name] = {
      ...result[name],
      ...profile,
    };
  }
  return result;
}
