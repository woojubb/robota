// A runtime process for the smoke's spawner pair: it answers the exchange on its inherited descriptor
// 4 as its first act, then starts a long-lived child and reports the child and its own instance key
// on one line. The smoke ends it.
import { spawn } from 'node:child_process';

import { createRuntimeIdentity } from '@robota-sdk/agent-keyring';

import { answerSpawnerPair } from '../dist/node/index.js';

const identity = createRuntimeIdentity();
answerSpawnerPair(identity);
const child = spawn(process.execPath, ['-e', 'setTimeout(() => undefined, 30000)'], {
  stdio: 'ignore',
});
process.stdout.write(
  `${JSON.stringify({
    grandchild: child.pid,
    instanceKey: Buffer.from(identity.instancePublicKey).toString('hex'),
  })}\n`,
);
setTimeout(() => process.exit(0), 30_000);
