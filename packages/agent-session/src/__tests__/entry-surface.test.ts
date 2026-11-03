import { describe, expect, it } from 'vitest';

import * as MainEntry from '../index.js';
import * as NodeEntry from '../node.js';

/**
 * The main entry is platform-neutral (ARCHITECTURE.md "Runtime platforms"); what needs a Node host
 * is on `./node`. The platform gate bundles the main entry and fails on a Node reach; this pins
 * which side each export is on, so a move back is a visible test failure.
 */
describe('session entry surfaces', () => {
  const nodeOnly = [
    'NodeSessionStore',
    'NodeSessionLogSink',
    'NodeSessionLogSource',
    'NodeExternalPayloadSource',
    'NodeToolResultSpillStore',
    'ToolResultSpillError',
    'NodePromptHistoryFile',
    'DEFAULT_PROMPT_HISTORY_BLOCK_BYTES',
    'parsePromptHistoryLine',
    'createNodeWorkspacePathResolver',
    'registerProcessExitFlush',
  ];

  it.each(nodeOnly)('%s is on ./node and not on the main entry', (name) => {
    expect(Object.keys(NodeEntry)).toContain(name);
    expect(Object.keys(MainEntry)).not.toContain(name);
  });

  it('keeps the session, its ports and the log helpers on the main entry', () => {
    for (const name of [
      'Session',
      'PermissionEnforcer',
      'CompactionOrchestrator',
      'FileSessionLogger',
      'createSessionLogExternalPayloadReference',
      'resolveSessionLogExternalPayloads',
      'loadSessionLogEntries',
    ]) {
      expect(Object.keys(MainEntry)).toContain(name);
    }
  });
});
