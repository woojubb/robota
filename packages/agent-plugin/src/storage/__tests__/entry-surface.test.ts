import { describe, expect, it } from 'vitest';

import * as MainEntry from '../../index';
import * as NodeEntry from '../../node';

/**
 * The main entry is platform-neutral (ARCHITECTURE.md "Runtime platforms"); the file store and the
 * process metrics collector are on `./node`. This pins which side each export is on.
 */
describe('plugin entry surfaces', () => {
  it.each(['NodePluginTextFileStore', 'NodeSystemMetricsCollector'])(
    '%s is on ./node and not on the main entry',
    (name) => {
      expect(Object.keys(NodeEntry)).toContain(name);
      expect(Object.keys(MainEntry)).not.toContain(name);
    },
  );

  it('keeps the plugins on the main entry', () => {
    expect(Object.keys(MainEntry)).toEqual(
      expect.arrayContaining(['PerformancePlugin', 'UsagePlugin', 'LoggingPlugin']),
    );
  });
});
