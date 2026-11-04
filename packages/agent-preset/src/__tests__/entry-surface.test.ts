import { describe, expect, it } from 'vitest';

import * as MainEntry from '../index.js';
import * as NodeEntry from '../node.js';

/**
 * Reading a directory is the Node host's: it is on `./node`, and the main entry loads presets from
 * the files a host hands it. This pins which side each export is on, so a move back is a visible
 * test failure.
 */
describe('preset entry surfaces', () => {
  it('has the directory loader on ./node and not on the main entry', () => {
    expect(Object.keys(NodeEntry)).toContain('loadExternalPresetsFromDir');
    expect(Object.keys(MainEntry)).not.toContain('loadExternalPresetsFromDir');
  });

  it('keeps the registry, the file loader and the output styles on the main entry', () => {
    for (const name of [
      'createPresetRegistry',
      'loadExternalPresetsFromFiles',
      'validateExternalPreset',
      'createOutputStyleRegistry',
      'parseOutputStyleFile',
    ]) {
      expect(Object.keys(MainEntry)).toContain(name);
    }
  });
});
