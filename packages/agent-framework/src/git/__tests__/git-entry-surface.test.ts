import { describe, expect, it } from 'vitest';

import * as MainEntry from '../../index.js';
import * as NodeEntry from '../../node.js';

/**
 * The git port and its readers are neutral and live on the main entry; the process that runs `git`
 * needs Node and lives on `./node`. One import path for each, and no copy on the other entry.
 */
describe('git entry surfaces', () => {
  const nodeOnly = [
    'createGitProcess',
    'gitEnvironment',
    'GIT_DEFAULT_TIMEOUT_MS',
    'GIT_ENV_DENYLIST',
    'GIT_MAX_OUTPUT_BYTES',
  ];
  const neutral = [
    'gitFailureMessage',
    'readProjectGitStatus',
    'readProjectGitDiff',
    'executeGitStatus',
    'executeGitDiff',
  ];

  it('puts the process that runs git on ./node and not on the main entry', () => {
    for (const name of nodeOnly) {
      expect(Object.keys(NodeEntry), name).toContain(name);
      expect(Object.keys(MainEntry), name).not.toContain(name);
    }
  });

  it('keeps the port’s words and the readers on the main entry and off ./node', () => {
    for (const name of neutral) {
      expect(Object.keys(MainEntry), name).toContain(name);
      expect(Object.keys(NodeEntry), name).not.toContain(name);
    }
  });
});
