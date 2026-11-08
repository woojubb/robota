/**
 * A runtime process for the spawner pair: it answers the exchange on descriptor 4 as its first act,
 * then serves one control endpoint on a loopback port so the spawner can link with the key it
 * derived. `--grandchild` starts a long-lived child after the exchange; `--spawn-before-close` is
 * the control that starts it while the descriptor is still open. Either prints one JSON line.
 */
import { spawn } from 'node:child_process';
import { closeSync, fstatSync, readSync, writeSync } from 'node:fs';

import { createRuntimeIdentity } from '@robota-sdk/agent-keyring';

import { SPAWNER_PAIR_FD, answerSpawnerPair, type ISpawnerPairIo } from '../../spawner-pair.js';
import { controlEndpoint, listen, recordingRuntime } from '../harness.js';

const startGrandchild = (): number | undefined =>
  spawn(process.execPath, ['-e', 'setTimeout(() => undefined, 60000)'], { stdio: 'ignore' }).pid;

let grandchild: number | undefined;
const identity = createRuntimeIdentity();

if (process.argv.includes('--spawn-before-close')) {
  const io: ISpawnerPairIo = {
    isHandedOverPair: (fd) => process.platform === 'win32' || fstatSync(fd, { bigint: true }).isSocket(),
    read: (fd, buffer, offset, length) => readSync(fd, buffer, offset, length, null),
    write: (fd, buffer, offset, length) => writeSync(fd, buffer, offset, length),
    close: (fd) => {
      grandchild = startGrandchild();
      closeSync(fd);
    },
  };
  answerSpawnerPair(identity, SPAWNER_PAIR_FD, io);
} else {
  answerSpawnerPair(identity);
  if (process.argv.includes('--grandchild')) grandchild = startGrandchild();
}

const server = await listen(controlEndpoint(identity, recordingRuntime(identity).admit));
process.stdout.write(`${JSON.stringify({ port: server.port, grandchild })}\n`);
// The spawner ends this process; nothing else keeps it alive.
setInterval(() => undefined, 1 << 30);
