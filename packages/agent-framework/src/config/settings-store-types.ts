/**
 * Leaf type module for {@link ISettingsDocumentStore}.
 *
 * Split out of `settings-store.ts` so `node-host-settings-store.ts` can depend on this type
 * without importing back from `settings-store.ts` (which imports
 * `createNodeHostSettingsStore` from `node-host-settings-store.ts`) — that previously created an
 * import cycle between the two.
 */
import type { TSettingsData } from './settings-io.js';
import type { TSettingsSource, THostSettingsScope, TProjectSettingsScope } from './settings-source.js';

export interface ISettingsDocumentStore {
  readonly kind: 'host' | 'project';
  readonly scope: THostSettingsScope | TProjectSettingsScope;
  readonly displayName: string;
  readonly source: TSettingsSource;
  read(): TSettingsData;
  write(settings: TSettingsData): void;
}
