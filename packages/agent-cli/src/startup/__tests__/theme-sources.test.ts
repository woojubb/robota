/**
 * SCREEN-2002 TC-11 — where theme files come from, and what happens to the ones that are wrong.
 *
 * The user directory is HOME-only, the plugin directories come from the installed plugins, and a
 * file that does not parse is skipped by name with its diagnostic rather than taking its neighbours
 * with it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it } from 'vitest';

import { loadThemeSources, MAX_ID_SEGMENT } from '../theme-sources.js';

const temporaryRoots: string[] = [];

function temporaryDirectory(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function writeTheme(directory: string, fileName: string, body: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, fileName), body);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('loadThemeSources', () => {
  it('reads the user directory through the host contribution source and namespaces its ids', () => {
    const home = temporaryDirectory('robota-theme-home-');
    writeTheme(
      join(home, '.robota', 'themes'),
      'mine.json',
      JSON.stringify({
        name: 'Mine',
        base: 'light',
        overrides: { colors: { text: { accent: 'red' } } },
      }),
    );

    const sources = loadThemeSources({ cwd: undefined, userHome: home, plugins: [] });

    expect(sources.skipped).toEqual([]);
    expect(sources.themes).toHaveLength(1);
    expect(sources.themes[0]?.id).toBe('custom:mine');
    expect(sources.themes[0]?.source).toBe('user');
    expect(sources.themes[0]?.colors.text.accent).toBe('red');
  });

  it('cannot shadow a built-in, whatever the file is called', () => {
    const home = temporaryDirectory('robota-theme-home-');
    writeTheme(join(home, '.robota', 'themes'), 'dark.json', '{}');

    const sources = loadThemeSources({ cwd: undefined, userHome: home, plugins: [] });

    expect(sources.themes[0]?.id).toBe('custom:dark');
  });

  it('skips a file it cannot apply, by name and with its diagnostic, and keeps its neighbours', () => {
    const home = temporaryDirectory('robota-theme-home-');
    const directory = join(home, '.robota', 'themes');
    writeTheme(directory, 'good.json', '{}');
    writeTheme(
      directory,
      'broken.json',
      JSON.stringify({ overrides: { colors: { text: { accent: 'not-a-colour' } } } }),
    );
    writeTheme(directory, 'garbage.json', '{ not json');

    const sources = loadThemeSources({ cwd: undefined, userHome: home, plugins: [] });

    expect(sources.themes.map((theme) => theme.id)).toEqual(['custom:good']);
    expect(sources.skipped.map((skip) => skip.fileName).sort()).toEqual([
      'broken.json',
      'garbage.json',
    ]);
    const broken = sources.skipped.find((skip) => skip.fileName === 'broken.json');
    expect(broken?.id).toBe('custom:broken');
    expect(broken?.reason).toMatch(/^\$\.overrides\.colors\.text\.accent: /u);
  });

  it('ignores anything that is not a .json file', () => {
    const home = temporaryDirectory('robota-theme-home-');
    writeTheme(join(home, '.robota', 'themes'), 'notes.md', 'not a theme');

    const sources = loadThemeSources({ cwd: undefined, userHome: home, plugins: [] });

    expect(sources.themes).toEqual([]);
    expect(sources.skipped).toEqual([]);
  });

  it('is the empty state, not an error, when the directory is absent', () => {
    const home = temporaryDirectory('robota-theme-home-');

    const sources = loadThemeSources({ cwd: undefined, userHome: home, plugins: [] });

    expect(sources).toEqual({ themes: [], skipped: [] });
  });

  it('reads a plugin directory and namespaces its ids under the plugin', () => {
    const home = temporaryDirectory('robota-theme-home-');
    const pluginDir = temporaryDirectory('robota-theme-plugin-');
    writeTheme(join(pluginDir, 'themes'), 'plugged.json', JSON.stringify({ name: 'Plugged' }));

    const sources = loadThemeSources({
      cwd: undefined,
      userHome: home,
      plugins: [{ name: 'theme-fixture', pluginDir }],
    });

    expect(sources.themes).toHaveLength(1);
    expect(sources.themes[0]?.id).toBe('custom:theme-fixture:plugged');
    expect(sources.themes[0]?.name).toBe('Plugged');
    expect(sources.themes[0]?.source).toBe('plugin');
  });

  it('does not report an id as taken by a theme that was itself refused', () => {
    // Claiming before the parse made a second file read "already taken by a theme loaded earlier"
    // when the first was refused and nothing was loaded — a reason naming a theme the run has not
    // got, and a second file that could have been fine.
    const home = temporaryDirectory('robota-theme-home-');
    const first = temporaryDirectory('robota-theme-plugin-a-');
    const second = temporaryDirectory('robota-theme-plugin-b-');
    writeTheme(join(first, 'themes'), 'one.json', '{ not json');
    writeTheme(join(second, 'themes'), 'one.json', JSON.stringify({ name: 'Second' }));

    const sources = loadThemeSources({
      cwd: undefined,
      userHome: home,
      plugins: [
        { name: 'same', pluginDir: first },
        { name: 'same', pluginDir: second },
      ],
    });

    expect(sources.themes.map((theme) => theme.name)).toEqual(['Second']);
    expect(sources.skipped.map((skip) => skip.reason)).toEqual([expect.stringMatching(/^\$: /u)]);
    expect(sources.skipped[0]?.reason).not.toMatch(/already/u);
  });

  it('keeps the first file to claim an id and skips the second, rather than silently replacing it', () => {
    const home = temporaryDirectory('robota-theme-home-');
    const first = temporaryDirectory('robota-theme-plugin-a-');
    const second = temporaryDirectory('robota-theme-plugin-b-');
    writeTheme(join(first, 'themes'), 'one.json', JSON.stringify({ name: 'First' }));
    writeTheme(join(second, 'themes'), 'one.json', JSON.stringify({ name: 'Second' }));

    const sources = loadThemeSources({
      cwd: undefined,
      userHome: home,
      plugins: [
        { name: 'same', pluginDir: first },
        { name: 'same', pluginDir: second },
      ],
    });

    expect(sources.themes.map((theme) => theme.name)).toEqual(['First']);
    expect(sources.skipped[0]?.id).toBe('custom:same:one');
    expect(sources.skipped[0]?.reason).toMatch(/already/u);
  });
  it('finds a plugin theme through the REAL scope layout, not only through an injected list', () => {
    // The injected `plugins` list above proves the reading; it cannot prove the discovery. Without
    // this, `pluginScopeDirs` could name the wrong directory and every test would still be green.
    const home = temporaryDirectory('robota-theme-home-');
    const versionDir = join(
      home,
      '.robota',
      'plugins',
      'cache',
      'fixtures',
      'theme-fixture',
      '1.0.0',
    );
    mkdirSync(join(versionDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(versionDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'theme-fixture',
        version: '1.0.0',
        description: 'themes only',
        features: {},
      }),
    );
    writeTheme(join(versionDir, 'themes'), 'plugged.json', JSON.stringify({ name: 'Plugged' }));

    // HOME is redirected for the call: plugin ENABLEMENT is read from the user settings document,
    // which `getUserSettingsPath()` resolves from the environment — so without this the case reads
    // the developer's own settings and a locally-disabled plugin would turn it red.
    const previousHome = process.env['HOME'];
    process.env['HOME'] = home;
    let sources;
    try {
      sources = loadThemeSources({ cwd: undefined, userHome: home });
    } finally {
      if (previousHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = previousHome;
    }

    expect(sources.themes.map((theme) => theme.id)).toEqual(['custom:theme-fixture:plugged']);
    expect(sources.themes[0]?.source).toBe('plugin');
  });

  it('does not discover themes from project plugins before workspace trust', () => {
    const home = temporaryDirectory('robota-theme-home-');
    const project = temporaryDirectory('robota-theme-project-');
    const versionDir = join(
      project,
      '.robota',
      'plugins',
      'cache',
      'fixtures',
      'project-theme',
      '1.0.0',
    );
    mkdirSync(join(versionDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(versionDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'project-theme', version: '1.0.0', description: 'project', features: {} }),
    );
    writeTheme(join(versionDir, 'themes'), 'project.json', '{}');

    const previousHome = process.env['HOME'];
    process.env['HOME'] = home;
    try {
      const sources = loadThemeSources({
        cwd: project,
        userHome: home,
        projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', project),
      });
      expect(sources).toEqual({ themes: [], skipped: [] });
    } finally {
      if (previousHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = previousHome;
    }
  });
});

describe('a file name that cannot become an id', () => {
  it('skips it with a reason rather than listing a theme no surface can apply', () => {
    // `/theme <id>` splits its arguments on whitespace and the picker commits through that same
    // command, so a slug with a space is listed, is selectable, and answers the usage line when
    // chosen — the one failure mode worse than not loading the file at all.
    const home = temporaryDirectory('robota-theme-home-');
    writeTheme(join(home, '.robota', 'themes'), 'My Theme.json', '{}');

    const sources = loadThemeSources({ cwd: undefined, userHome: home, plugins: [] });

    expect(sources.themes).toEqual([]);
    expect(sources.skipped).toHaveLength(1);
    expect(sources.skipped[0]?.reason).toMatch(/cannot be a theme id/u);
    // Escaped but NOT quoted: both consumers wrap this field in quotes of their own, so a quoted
    // value here prints as `Skipped theme ""My Theme.json"": …`.
    expect(sources.skipped[0]?.fileName).toBe('My Theme.json');
  });

  it('refuses a name too long to be drawn in the row it lands in', () => {
    // The bound is on the ID SEGMENT, not only on a document-supplied name: the id is rendered
    // beside the name whether or not the file supplies one.
    const home = temporaryDirectory('robota-theme-home-');
    writeTheme(join(home, '.robota', 'themes'), `${'x'.repeat(MAX_ID_SEGMENT + 1)}.json`, '{}');

    const sources = loadThemeSources({ cwd: undefined, userHome: home, plugins: [] });

    expect(sources.themes).toEqual([]);
    expect(sources.skipped[0]?.reason).toContain(`at most ${MAX_ID_SEGMENT} characters`);
  });

  it('gates the PLUGIN half of an id too, and loads none of that plugin s themes', () => {
    // A manifest `name` is checked for being a string and nothing else, so it is third-party text
    // on its way into an id, a `/theme list` row and — for a file that omits `name` — the rendered
    // name of an APPLIED theme.
    const home = temporaryDirectory('robota-theme-home-');
    const pluginDir = temporaryDirectory('robota-theme-plugin-');
    writeTheme(join(pluginDir, 'themes'), 'ocean.json', JSON.stringify({ name: 'Ocean' }));

    const sources = loadThemeSources({
      cwd: undefined,
      userHome: home,
      plugins: [{ name: 'my plugin', pluginDir }],
    });

    expect(sources.themes).toEqual([]);
    expect(sources.skipped).toHaveLength(1);
    expect(sources.skipped[0]?.reason).toMatch(
      /plugin name "my plugin" cannot be part of a theme id/u,
    );
  });

  it('keeps a control character in a plugin name off the terminal', () => {
    const home = temporaryDirectory('robota-theme-home-');
    const pluginDir = temporaryDirectory('robota-theme-plugin-');
    const csi = String.fromCharCode(0x9b);
    writeTheme(join(pluginDir, 'themes'), 'ocean.json', '{}');

    const sources = loadThemeSources({
      cwd: undefined,
      userHome: home,
      plugins: [{ name: `${csi}2J`, pluginDir }],
    });

    expect(sources.skipped[0]?.reason).not.toContain(csi);
    expect(sources.skipped[0]?.fileName).not.toContain(csi);
  });

  it('LOADS the longest id it can mint, so the two bounds are sized against each other', () => {
    // The pair that has to hold: `custom:` + a 24-character plugin segment + `:` + a 24-character
    // file segment must be a legal NAME, because it IS the name when the file supplies none.
    const home = temporaryDirectory('robota-theme-home-');
    const pluginDir = temporaryDirectory('robota-theme-plugin-');
    // Derived from the bound, not transcribed: raising `MAX_ID_SEGMENT` past what the parser's
    // name bound allows must turn THIS red, which a hardcoded 24 would not.
    writeTheme(join(pluginDir, 'themes'), `${'s'.repeat(MAX_ID_SEGMENT)}.json`, '{}');

    const sources = loadThemeSources({
      cwd: undefined,
      userHome: home,
      plugins: [{ name: 'p'.repeat(MAX_ID_SEGMENT), pluginDir }],
    });

    expect(sources.skipped).toEqual([]);
    expect(sources.themes).toHaveLength(1);
    expect(sources.themes[0]?.name).toBe(sources.themes[0]?.id);
  });

  it('keeps a control character in a file name off the terminal', () => {
    const home = temporaryDirectory('robota-theme-home-');
    const escape = String.fromCharCode(27);
    writeTheme(join(home, '.robota', 'themes'), `${escape}[2J.json`, '{}');

    const sources = loadThemeSources({ cwd: undefined, userHome: home, plugins: [] });

    expect(sources.skipped).toHaveLength(1);
    expect(sources.skipped[0]?.reason).not.toContain(escape);
    expect(sources.skipped[0]?.fileName).not.toContain(escape);
  });
});
