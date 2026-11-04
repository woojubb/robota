import { describe, expect, it, vi } from 'vitest';

import { loadExternalPresetsFromFiles } from '../load-external-presets.js';
import { createPresetRegistry } from '../resolve-preset.js';

import type { IExternalPresetFile } from '../load-external-presets.js';

const file = (fileName: string, value: unknown): IExternalPresetFile => ({
  fileName,
  read: () => (typeof value === 'string' ? value : JSON.stringify(value)),
});

const valid = (id: string) => ({ id, title: id, description: `The ${id} preset.` });

/**
 * The package reads no file itself: a host hands it the candidate files. These cases hold the
 * loader's rules over files that exist nowhere on a disk, which is what a browser host has.
 */
describe('loadExternalPresetsFromFiles', () => {
  it('loads every valid preset in the order given and registers nothing', () => {
    const result = loadExternalPresetsFromFiles([
      file('b.json', valid('b-style')),
      file('a.json', valid('a-style')),
    ]);

    expect(result.loaded).toEqual(['b-style', 'a-style']);
    expect(result.errors).toEqual([]);
    expect(
      createPresetRegistry()
        .listPresets()
        .map((preset) => preset.id),
    ).not.toContain('a-style');
    expect(
      createPresetRegistry(result.presets)
        .listPresets()
        .map((preset) => preset.id),
    ).toContain('a-style');
  });

  it('reads only `*.json` files and never touches another name', () => {
    const readme = vi.fn(() => 'not a preset');
    const result = loadExternalPresetsFromFiles([
      { fileName: 'README.md', read: readme },
      { fileName: 'preset.json.bak', read: readme },
      file('real.json', valid('real-style')),
    ]);

    expect(readme).not.toHaveBeenCalled();
    expect(result.loaded).toEqual(['real-style']);
    expect(result.errors).toEqual([]);
  });

  it('records a file that cannot be read, a malformed one and an invalid one as that file’s error and loads the rest', () => {
    const result = loadExternalPresetsFromFiles([
      {
        fileName: 'unreadable.json',
        read: () => {
          throw new Error('EACCES: permission denied');
        },
      },
      file('malformed.json', '{ not json'),
      file('invalid.json', { id: 'invalid-style', description: 'No title.' }),
      file('good.json', valid('good-style')),
    ]);

    expect(result.loaded).toEqual(['good-style']);
    expect(result.errors.map((entry) => entry.file)).toEqual([
      'unreadable.json',
      'malformed.json',
      'invalid.json',
    ]);
    expect(result.errors[0]?.error).toBe('EACCES: permission denied');
  });

  it('reports a built-in id collision and a duplicate id against the file that carried them', () => {
    const result = loadExternalPresetsFromFiles([
      file('default.json', valid('default')),
      file('first.json', valid('twice')),
      file('second.json', valid('twice')),
    ]);

    expect(result.errors.find((entry) => entry.file === 'default.json')?.error).toBe(
      'collides with built-in preset',
    );
    expect(result.loaded).toEqual(['twice']);
    expect(result.errors.filter((entry) => entry.file === 'second.json')).toHaveLength(1);
  });

  it('with no files, loads nothing and reports nothing', () => {
    expect(loadExternalPresetsFromFiles([])).toEqual({ presets: [], loaded: [], errors: [] });
  });
});
