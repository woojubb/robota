/**
 * The one composition root for host bundle-plugin loading.
 *
 * `BundlePluginLoader` takes its enablement map as an OPTIONAL constructor argument and defaults a
 * missing one to `{}`. `isDisabled` then answers `false` for every plugin, because "not listed" means
 * enabled. So a caller that omits the map does not get "enablement unknown" — it gets "everything
 * enabled", which is the same shape as a user who has disabled nothing.
 *
 * Every production site omitted it (PLG-021 / issue #2025). A user who disabled a plugin saw it
 * reported as disabled while its hooks, commands and skills kept loading — and disable is a
 * containment action, so the assurance is at its most misleading exactly when it matters.
 *
 * The fix is placed HERE rather than at each call site on purpose: the treatment belongs where the
 * loader is MADE, so a new caller cannot obtain one without the enablement state. Repairing the
 * three known sites would have left the next site unguarded by default, which is how these three
 * came to exist.
 *
 * The raw constructor stays exported — it is public API of a published package, and a consumer who
 * has their own enablement source is entitled to it. What changes is that nothing inside this
 * repository reaches it without an answer to "which plugins did the user disable?".
 */

import { BundlePluginLoader } from './bundle-plugin-loader.js';
import { NodeHostPluginSettingsStore } from './plugin-settings-store.js';
import { getUserSettingsPath } from '../config/settings-io.js';

import type { TEnabledPlugins } from './bundle-plugin-types.js';
import type { IFileSystem } from '@robota-sdk/agent-core';

/**
 * Where the host keeps plugin bundles and the settings file that records their enablement.
 *
 * `pluginsDir` is REQUIRED and deliberately has no default. A first draft defaulted it, and the
 * `product-identity` ratchet refused the change with the argument that settles it: a library that
 * names its consumer's product hands every other product that name too. The host knows where its
 * bundles live; this module does not, and should not learn.
 */
export interface IHostBundlePluginLoaderOptions {
  /** The host's bundle cache directory. No default — the host owns this path. */
  pluginsDir: string;
  /** Defaults to `getUserSettingsPath()`, which is this repository's one owner of that path. */
  settingsPath?: string;
  /** Injectable for tests; both the store and the loader read through it. */
  fs?: IFileSystem;
  /**
   * Enablement state, when the caller already holds it. Omitted, it is READ from `settingsPath`.
   *
   * This is not the loader's optional argument re-exposed: there, omission means "assume everything
   * is enabled"; here it means "go and find out".
   */
  enabledPlugins?: TEnabledPlugins;
}

/** Build a bundle-plugin loader that knows which plugins the user disabled. */
export function createHostBundlePluginLoader(
  options: IHostBundlePluginLoaderOptions,
): BundlePluginLoader {
  const settingsPath = options.settingsPath ?? getUserSettingsPath();

  const enabledPlugins =
    options.enabledPlugins ??
    new NodeHostPluginSettingsStore(settingsPath, options.fs).getEnabledPlugins();

  return new BundlePluginLoader(options.pluginsDir, enabledPlugins, options.fs);
}
