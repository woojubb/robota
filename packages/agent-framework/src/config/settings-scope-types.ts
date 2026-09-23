/**
 * Leaf type module for {@link THostSettingsScope}.
 *
 * Split out of `settings-source.ts` so `node-host-settings-source.ts` can depend on this type
 * without importing back from `settings-source.ts` (which imports
 * `createNodeHostSettingsSource`/`readNodeHostSettingsSource` from
 * `node-host-settings-source.ts`) — that previously created an import cycle between the two.
 */
export type THostSettingsScope = 'managed' | 'user';
