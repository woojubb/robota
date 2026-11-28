import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ALL_CODING_TASKS } from './outcome-coding-tasks-repository.js';
import { materializeTask, runContainerVerifier } from './outcome-coding-verify.js';

/**
 * Opt-in: runs the exact broken and solved controls through the locked-down verifier container.
 * Set ROBOTA_EVAL_DOCKER=1 with a local Docker daemon and an image that has Node already pulled
 * (ROBOTA_EVAL_DOCKER_IMAGE, default node:22). ROBOTA_EVAL_DOCKER_TMP selects a host directory the
 * daemon can mount (default: the home directory).
 */
const enabled = process.env.ROBOTA_EVAL_DOCKER === '1';
const image = process.env.ROBOTA_EVAL_DOCKER_IMAGE ?? 'node:22';
const base = process.env.ROBOTA_EVAL_DOCKER_TMP ?? homedir();

test(
  'controls in the verifier container: broken fails, solved passes, for every task',
  { skip: enabled ? false : 'set ROBOTA_EVAL_DOCKER=1 to run', timeout: 300_000 },
  async () => {
    for (const definition of ALL_CODING_TASKS) {
      for (const kind of ['broken', 'solved'] as const) {
        const root = mkdtempSync(join(base, '.coding-docker-'));
        try {
          chmodSync(root, 0o755);
          materializeTask(definition, root, kind);
          const observation = await runContainerVerifier(definition, root, { image });
          assert.equal(observation.timedOut, false, `${definition.id} ${kind} timed out`);
          if (kind === 'solved') {
            assert.equal(observation.exitCode, 0, `${definition.id} solved must pass`);
          } else {
            assert.notEqual(observation.exitCode, 0, `${definition.id} broken must fail`);
            assert.notEqual(observation.exitCode, null, `${definition.id} broken must exit`);
          }
          assert.equal(observation.protectedFilesUnchanged, true);
          assert.equal(observation.noUnexpectedFiles, true);
          assert.equal(observation.noEscapes, true);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }
    }
  },
);
