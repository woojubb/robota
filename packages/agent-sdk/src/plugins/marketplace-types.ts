/**
 * Shared types for marketplace client and registry.
 */

/** Source specification for a marketplace. */
export type IMarketplaceSource =
  | { type: 'github'; repo: string; ref?: string }
  | { type: 'git'; url: string; ref?: string }
  | { type: 'local'; path: string }
  | { type: 'url'; url: string };

/** A single plugin entry in a marketplace manifest. */
export interface IMarketplacePluginEntry {
  name: string;
  title: string;
  description: string;
  source: string | { type: 'github'; repo: string } | { type: 'url'; url: string };
  tags: string[];
}

/** Manifest format read from `.claude-plugin/marketplace.json`. */
export interface IMarketplaceManifest {
  name: string;
  version: string;
  plugins: IMarketplacePluginEntry[];
}

/** Entry in known_marketplaces.json. */
export interface IKnownMarketplaceEntry {
  source: IMarketplaceSource;
  installLocation: string;
  lastUpdated: string;
}

/** Shape of known_marketplaces.json. */
export type IKnownMarketplacesRegistry = Record<string, IKnownMarketplaceEntry>;

/** Exec function type for running shell commands. */
export type ExecFn = (
  command: string,
  options: { timeout: number; stdio?: string },
) => string | Buffer;

/** Options for constructing a MarketplaceClient. */
export interface IMarketplaceClientOptions {
  /** Base plugins directory (e.g., `~/.robota/plugins`). */
  pluginsDir: string;
  /** Custom exec function for testing (replaces child_process.execSync). */
  exec?: ExecFn;
}
