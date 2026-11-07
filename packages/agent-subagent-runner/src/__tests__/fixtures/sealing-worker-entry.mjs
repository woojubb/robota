/**
 * #3679 step 3b: a composition root that SEALS, entering the real worker entry point.
 *
 * Its sealer is a stand-in that works across the process boundary (the agent-core test double's
 * grant names a key in the parent process only): a "sealed" line or file is `RSL1` framing over
 * base64url JSON naming the grant's key, so the parent can tell which grant sealed what. It is a
 * fixture for the routing — the grant reaching the child, the child binding it before anything is
 * built, a newer grant replacing it, the held record taken by the store — not cryptography.
 *
 * Records what it is asked to do, in order, to `SEALING_FIXTURE_RECORD`, and each message its parent
 * sends (with the grant a `start` or `sealing_key` carries). `SEALING_FIXTURE_BIND` makes its
 * `bindWriteGrant` misbehave: `none` (absent), `plain` (binds nothing), `foreign` (a sealer for
 * another key), `stale` (a newer grant leaves the sealer on the old key). A parent sandbox of type
 * `fixture` is restored from its snapshot, and the restore waits for `SEALING_FIXTURE_RESTORE_UNTIL`
 * when set, so a test can send a message while the child is still being built.
 */
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { ArtifactCorruptError, ArtifactLockedError } from '@robota-sdk/agent-core';
import { createUserSessionStore } from '@robota-sdk/agent-framework/node';

import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';
import { runSubagentWorkerMain } from '../../../dist/node/index.js';

const RECORD_PATH = process.env.SEALING_FIXTURE_RECORD;
const HOLD_UNTIL = process.env.SEALING_FIXTURE_HOLD_UNTIL;
const RESTORE_UNTIL = process.env.SEALING_FIXTURE_RESTORE_UNTIL;
const GRANT_PREFIX = 'fixture-grant:';

function record(event) {
  if (RECORD_PATH) appendFileSync(RECORD_PATH, `${JSON.stringify(event)}\n`, 'utf8');
}

function keyOf(grant) {
  if (typeof grant !== 'string' || !grant.startsWith(GRANT_PREFIX)) {
    throw new RangeError('The write grant is not one this fixture issues.');
  }
  return grant.slice(GRANT_PREFIX.length);
}

function sealed(key, context, text) {
  return Buffer.from(JSON.stringify({ key, kind: context.kind, id: context.id, text })).toString(
    'base64url',
  );
}

/** Seals to the key its grant names; opens nothing. */
class FixtureWriteOnlySealer {
  constructor(grant) {
    this.key = keyOf(grant);
  }
  replaceGrant(grant) {
    this.key = keyOf(grant);
  }
  sealLine(plain, context) {
    return `RSL1:${sealed(this.key, context, plain)}`;
  }
  sealBytes(plain, context) {
    return Buffer.from(`RSL1${sealed(this.key, context, Buffer.from(plain).toString('utf8'))}`);
  }
  openLine(stored) {
    if (!stored.startsWith('RSL1:')) throw new ArtifactCorruptError();
    throw new ArtifactLockedError('no-keys');
  }
  openBytes(stored) {
    if (Buffer.from(stored).subarray(0, 4).toString('latin1') !== 'RSL1') {
      throw new ArtifactCorruptError();
    }
    throw new ArtifactLockedError('no-keys');
  }
  isSealedLine(stored) {
    return /^RSL[0-9]:/.test(stored);
  }
  isSealedBytes(stored) {
    return /^RSL[0-9]$/.test(Buffer.from(stored).subarray(0, 4).toString('latin1'));
  }
  writeGrant() {
    return `${GRANT_PREFIX}${this.key}`;
  }
}

let bound;
const BIND = process.env.SEALING_FIXTURE_BIND;

// Installed before the worker's own listener, so it sees every parent message in the order it came.
process.on('message', (message) => {
  const grant =
    message?.type === 'start'
      ? message.payload?.writeGrant
      : message?.type === 'sealing_key'
        ? message.grant
        : undefined;
  record({ received: message?.type, ...(grant === undefined ? {} : { grant }) });
});

function bindWriteGrant(grant) {
  record({ bind: grant });
  if (BIND === 'plain') return 'plain';
  if (BIND === 'foreign')
    return { sealer: new FixtureWriteOnlySealer(`${GRANT_PREFIX}someone-else`) };
  if (bound === undefined) bound = new FixtureWriteOnlySealer(grant);
  else if (BIND !== 'stale') bound.replaceGrant(grant);
  return { sealer: bound };
}

async function waitForFile(path) {
  if (!path) return;
  while (!existsSync(path)) await new Promise((resolve) => setTimeout(resolve, 20));
}

const holdIfAsked = () => waitForFile(HOLD_UNTIL);

runSubagentWorkerMain({
  host: createTestFrameworkHost(),
  createTools: () => [],
  sandboxFactories: {
    fixture: async (snapshotId) => {
      record({ restore: snapshotId });
      await waitForFile(RESTORE_UNTIL);
      return { name: 'fixture-sandbox' };
    },
  },
  providerDefinitions: [
    {
      type: 'openai',
      createProvider: () => {
        record({ createProvider: true });
        return {
          name: 'openai',
          chat: async () => {
            record({ chat: true });
            await holdIfAsked();
            return {
              role: 'assistant',
              content: 'the child process answers',
              timestamp: new Date(),
            };
          },
        };
      },
    },
  ],
  openSessionStore: ({ cwd }) => {
    record({ openSessionStore: cwd });
    return createUserSessionStore(join(cwd, 'sessions'), {
      sealing: bound === undefined ? 'plain' : { sealer: bound },
    });
  },
  ...(BIND === 'none' ? {} : { bindWriteGrant }),
});
