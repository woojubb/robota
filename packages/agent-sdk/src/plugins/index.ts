// Plugin settings store — shared persistence for plugin config
export { PluginSettingsStore } from './plugin-settings-store.js';
export type { IPluginSettings } from './plugin-settings-store.js';

// BundlePlugin system — directory-based plugin packages
export { BundlePluginLoader } from './bundle-plugin-loader.js';
export type {
  IBundlePluginManifest,
  IBundlePluginFeatures,
  IBundleSkill,
  ILoadedBundlePlugin,
  TEnabledPlugins,
} from './bundle-plugin-types.js';

// BundlePlugin installer — install, uninstall, enable, disable plugins
export { BundlePluginInstaller } from './bundle-plugin-installer.js';
export type {
  IBundlePluginInstallerOptions,
  IInstalledPluginRecord,
  IInstalledPluginsRegistry,
} from './bundle-plugin-installer.js';

// Marketplace client — discover plugins from marketplace registries
export { MarketplaceClient } from './marketplace-client.js';
export type {
  IMarketplaceSource,
  IMarketplaceManifest,
  IMarketplacePluginEntry,
  IMarketplaceClientOptions,
  IKnownMarketplaceEntry,
  IKnownMarketplacesRegistry,
} from './marketplace-client.js';
