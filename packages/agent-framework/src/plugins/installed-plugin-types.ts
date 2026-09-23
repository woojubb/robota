/**
 * Leaf type module for {@link IInstalledPluginRecord} and {@link TInstalledPluginsRegistry}.
 *
 * Split out of `bundle-plugin-installer.ts` so `installed-plugins-registry.ts` can depend on
 * these types without importing back from `bundle-plugin-installer.ts` (which imports the
 * registry's read/write functions), which previously created an import cycle between the two.
 */

/** Record of an installed plugin in installed_plugins.json. */
export interface IInstalledPluginRecord {
  pluginName: string;
  marketplace: string;
  version: string;
  installPath: string;
  installedAt: string;
}

/** Shape of installed_plugins.json. */
export type TInstalledPluginsRegistry = Record<string, IInstalledPluginRecord>;
