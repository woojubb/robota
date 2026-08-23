/**
 * Shared types for marketplace client and registry.
 */

/** Source specification for a marketplace. */
export type TMarketplaceSource =
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
  source: TMarketplaceSource;
  installLocation: string;
  lastUpdated: string;
}

/** Shape of known_marketplaces.json. */
export type TKnownMarketplacesRegistry = Record<string, IKnownMarketplaceEntry>;

/**
 * Run one executable with an ARGUMENT VECTOR. Injected at composition root.
 *
 * SEC-017 (issue #2019): this was `(command: string, …)`, and the adapter behind it passed that string
 * to `execSync`, which always runs its argument through a shell. Every marketplace URL, plugin
 * repository URL and persisted install path was interpolated into that string, so a source containing
 * `;` or `$(…)` executed additional host commands during add, update, revision lookup or install.
 *
 * A vector is what makes it safe by construction rather than by quoting: no shell parses these values,
 * so there is no quoting to get right. The repository already reached this conclusion once —
 * `apps/action/src/build-invocation.ts` (SEC-006) replaced `execSync(args.join(' '))` for the same
 * reason — and this is that fix applied to the plugin surface.
 *
 * `file` is the executable. `args` is readonly because an implementation must not be able to fold an
 * argument back into the command line.
 */
export type TExecFn = (
  file: string,
  args: readonly string[],
  options: { timeout: number; stdio?: string },
) => string | Buffer;

/** Options for constructing a MarketplaceClient. */
export interface IMarketplaceClientOptions {
  /** Base plugins directory (e.g., `~/.robota/plugins`). */
  pluginsDir: string;
  /** Argv process adapter — must be provided at composition root (e.g., execFileSync). */
  exec: TExecFn;
}
