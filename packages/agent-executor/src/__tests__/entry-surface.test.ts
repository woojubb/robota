import { describe, expect, it } from 'vitest';

import * as MainEntry from '../index.js';
import * as NodeEntry from '../node.js';

/**
 * The main entry is platform-neutral (ARCHITECTURE.md "Runtime platforms"); what spawns processes or
 * reports through `process` is on `./node`. The platform gate bundles the main entry and fails on a
 * Node reach; this pins which side each export is on, so a move back is a visible test failure.
 */
describe('executor entry surfaces', () => {
  const nodeOnly = [
    'createDefaultBackgroundTaskRunners',
    'createManagedShellProcessRunner',
    'createScheduledTaskRunner',
    'resolveBackgroundTaskShellCommand',
    'reportObserverFailureAsProcessWarning',
  ];

  it.each(nodeOnly)('%s is on ./node and not on the main entry', (name) => {
    expect(Object.keys(NodeEntry)).toContain(name);
    expect(Object.keys(MainEntry)).not.toContain(name);
  });

  it('keeps the next-fire calculation and the neutral runner on the main entry', () => {
    expect(Object.keys(MainEntry)).toContain('nextScheduledFireOnOrAfter');
    expect(Object.keys(MainEntry)).toContain('createToolInvocationBackgroundTaskRunner');
  });
});
