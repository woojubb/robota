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
export type { IPluginSource, IBundlePluginInstallerOptions } from './bundle-plugin-installer.js';

// Marketplace client — discover plugins from marketplace sources
export { MarketplaceClient } from './marketplace-client.js';
export type {
  IMarketplaceSource,
  IMarketplaceManifest,
  IMarketplacePluginEntry,
  IMarketplaceClientOptions,
} from './marketplace-client.js';
