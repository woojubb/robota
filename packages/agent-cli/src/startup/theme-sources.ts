/**
 * SCREEN-2002 — the theme files a run can see, and the ones it refuses.
 *
 * Two sources, one policy. The user directory is `~/.robota/themes`, read through the same
 * root-bounded host contribution source `~/.robota/output-styles` is read through — home-only,
 * because a theme is a preference of the person at the terminal rather than of the checkout. Plugin
 * themes come from `<pluginDir>/themes` for each INSTALLED plugin, which is project-reachable,
 * because `pluginScopeDirs` includes the project scope; that asymmetry is deliberate and stated.
 *
 * Ids are minted HERE, from where the file was found — `custom:<slug>` and
 * `custom:<plugin>:<slug>` — so a file can never claim a built-in's id whatever it is called, and
 * the document itself never gets a say in what it is called.
 *
 * A file that does not parse is skipped by name with its own diagnostic and its neighbours still
 * load, the way one unreadable plugin manifest stopped taking every plugin down with it (CORE-029).
 */
import { join } from 'node:path';

import { pluginScopeDirs } from '@robota-sdk/agent-command';
import {
  createNodeHostContributionSource,
  loadHostBundlePluginsFromScopes,
} from '@robota-sdk/agent-framework';
import { parseThemeDocument } from '@robota-sdk/agent-ui-terminal';

import type { IContributionSource } from '@robota-sdk/agent-framework';
import type { IThemeSkip, ITuiTheme, TThemeSource } from '@robota-sdk/agent-ui-terminal';

const USER_THEME_DIRECTORY = join('.robota', 'themes');
const PLUGIN_THEME_DIRECTORY = 'themes';
const THEME_FILE_SUFFIX = '.json';

/**
 * What a file name may contribute to an id.
 *
 * An id is TYPED — `/theme <id>` splits its arguments on whitespace, and the picker commits by
 * submitting that same command — so a slug the command grammar cannot carry produces a theme that
 * is listed, is shown as a selectable row, and answers the usage line when chosen. That is worse
 * than not loading it: the file appears to work everywhere except the one place it matters. A name
 * outside this set is skipped with a reason, the same policy an already-taken id gets.
 */
const SAFE_SLUG = /^[A-Za-z0-9._-]+$/u;

/** One installed plugin, reduced to what a theme needs from it. */
export interface IThemePluginDirectory {
  readonly name: string;
  readonly pluginDir: string;
}

export interface IThemeSourcesOptions {
  readonly cwd: string | undefined;
  readonly userHome: string;
  /**
   * The installed plugins. Injected so a test can hand over two directories without installing a
   * marketplace; the default asks the same loader the command layer asks.
   */
  readonly plugins?: readonly IThemePluginDirectory[];
}

export interface IThemeSources {
  readonly themes: readonly ITuiTheme[];
  readonly skipped: readonly IThemeSkip[];
}

interface ICollector {
  readonly themes: ITuiTheme[];
  readonly skipped: IThemeSkip[];
  readonly claimed: Set<string>;
}

function readThemeDirectory(
  source: IContributionSource,
  directory: string,
  purpose: string,
): readonly { readonly fileName: string; readonly text: string | undefined }[] {
  return source
    .listDirectory(directory, purpose)
    .filter((entry) => entry.kind === 'file' && entry.name.endsWith(THEME_FILE_SUFFIX))
    .map((entry) => ({
      fileName: entry.name,
      text: source.readText(join(directory, entry.name), purpose),
    }));
}

function collectFrom(
  collector: ICollector,
  options: {
    readonly root: string;
    readonly directory: string;
    readonly source: TThemeSource;
    readonly idPrefix: string;
  },
): void {
  const purpose = `load ${options.source} themes`;
  const reader = createNodeHostContributionSource(options.root);
  for (const file of readThemeDirectory(reader, options.directory, purpose)) {
    const slug = file.fileName.slice(0, -THEME_FILE_SUFFIX.length);
    if (!SAFE_SLUG.test(slug)) {
      collector.skipped.push({
        id: `${options.idPrefix}?`,
        // Quoted, because the name is the untrusted part: it is about to be printed to a terminal
        // and shown in the picker, and this is the one skip whose file name is not a safe slug.
        fileName: JSON.stringify(file.fileName),
        reason: `$: the file name ${JSON.stringify(file.fileName)} cannot be a theme id — use letters, digits, dot, dash or underscore`,
      });
      continue;
    }
    const id = `${options.idPrefix}${slug}`;
    if (collector.claimed.has(id)) {
      collector.skipped.push({
        id,
        fileName: file.fileName,
        reason: `$: the id "${id}" is already taken by a theme loaded earlier`,
      });
      continue;
    }
    collector.claimed.add(id);
    if (file.text === undefined) {
      collector.skipped.push({
        id,
        fileName: file.fileName,
        reason: '$: the file could not be read',
      });
      continue;
    }
    const parsed = parseThemeDocument({
      id,
      fileName: file.fileName,
      source: options.source,
      text: file.text,
    });
    if (parsed.ok) collector.themes.push(parsed.theme);
    else collector.skipped.push({ id, fileName: file.fileName, reason: parsed.error });
  }
}

/**
 * The installed plugins, or a SKIP that says the scopes could not be read.
 *
 * A plugin scope that cannot be enumerated must not fail the start — a broken plugin directory is
 * not a reason to refuse a terminal — but it must not be silent either, or plugin themes simply are
 * not there and nothing says why. It becomes a skip beside the file-level ones, so it is printed at
 * startup and shown in the picker on the same terms.
 */
function installedPlugins(
  cwd: string | undefined,
  userHome: string,
  collector: ICollector,
): IThemePluginDirectory[] {
  const scopes = pluginScopeDirs(cwd, userHome);
  try {
    return loadHostBundlePluginsFromScopes(scopes).map((plugin) => ({
      name: plugin.manifest.name,
      pluginDir: plugin.pluginDir,
    }));
  } catch (error) {
    collector.skipped.push({
      id: 'custom:<plugins>',
      fileName: scopes.join(', '),
      reason: `$: the plugin scopes could not be read — ${error instanceof Error ? error.message : String(error)}`,
    });
    return [];
  }
}

/** Every theme file this run can see, and every one it refuses, in the order they were found. */
export function loadThemeSources(options: IThemeSourcesOptions): IThemeSources {
  const collector: ICollector = { themes: [], skipped: [], claimed: new Set() };
  collectFrom(collector, {
    root: options.userHome,
    directory: USER_THEME_DIRECTORY,
    source: 'user',
    idPrefix: 'custom:',
  });
  const plugins = options.plugins ?? installedPlugins(options.cwd, options.userHome, collector);
  for (const plugin of plugins) {
    collectFrom(collector, {
      root: plugin.pluginDir,
      directory: PLUGIN_THEME_DIRECTORY,
      source: 'plugin',
      idPrefix: `custom:${plugin.name}:`,
    });
  }
  return { themes: collector.themes, skipped: collector.skipped };
}
