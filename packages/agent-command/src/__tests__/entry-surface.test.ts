import { describe, expect, it } from 'vitest';

import * as MainEntry from '../index.js';
import * as NodeEntry from '../node.js';

/**
 * What touches a host is on `./node`; the main entry names none of it (ARCHITECTURE.md "Runtime
 * platforms"). The platform probe reports a Node reach; this pins which side each export is on, so a
 * move back is a visible test failure.
 */
describe('command entry surfaces', () => {
  const nodeOnly = [
    // `/shell` and `/editor` hand the real terminal to a child process.
    'createShellCommandModule',
    'createShellCommandEntry',
    'executeShellCommand',
    'resolveShell',
    'spawnInherited',
    'createEditorCommandModule',
    'createEditorCommandEntry',
    'executeEditorCommand',
    'resolveEditor',
    'openFileInEditor',
    // An attached terminal runs the terminal commands itself, `/shell` and `/editor` among them.
    'createTerminalClientCommands',
    // The doctor's probes and writers, which `/doctor` takes by injection.
    'createNodeDoctorDeps',
    'resolveCommandOnPath',
  ];

  it.each(nodeOnly)('%s is on ./node and not on the main entry', (name) => {
    expect(Object.keys(NodeEntry)).toContain(name);
    expect(Object.keys(MainEntry)).not.toContain(name);
  });

  it('keeps the default assembly and the commands that take a host capability on the main entry', () => {
    for (const name of [
      'createDefaultCommandModules',
      'createDoctorCommandModule',
      'runDoctor',
      'applyDoctorRepair',
      'createKeybindingsCommandModule',
      'createScheduleCommandModule',
      'executeLoopCommand',
      'ensureProviderConfig',
      'createModelCommandModule',
    ]) {
      expect(Object.keys(MainEntry)).toContain(name);
    }
  });
});
