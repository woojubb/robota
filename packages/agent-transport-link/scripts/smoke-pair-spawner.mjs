// The spawner's side of the smoke's pair check, always run by Node: a runtime process (this smoke's
// own runtime, Node or Bun, passed as the first argument) answers the exchange on its inherited
// descriptor 4 as its first act and closes it before it starts a child; the pair then ends while that
// child is alive, and the key the spawner derives names the runtime's instance key.
//
// Node is the spawner even under Bun because the runtime is what the smoke measures, and Bun's
// `child_process` gives its caller no stream for an extra pipe (`stdio[4]` is null there, measured on
// Bun 1.3.11): see the note the smoke prints about it.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { startSpawnerExchange } from '@robota-sdk/agent-keyring';

import { completeSpawnerPair } from '../dist/node/index.js';

const runtimeExecutable = process.argv[2];
const runtimeScript = fileURLToPath(new URL('./smoke-pair-runtime.mjs', import.meta.url));

const startRuntime = () => {
  const child = spawn(runtimeExecutable, [runtimeScript], {
    stdio: ['ignore', 'pipe', 'inherit', 'ignore', 'pipe'],
  });
  const line = new Promise((resolve, reject) => {
    let text = '';
    child.stdout.on('data', (chunk) => {
      text += chunk.toString('utf8');
      if (text.includes('\n')) resolve(JSON.parse(text));
    });
    child.once('exit', () => reject(new Error('The pair runtime ended before it reported.')));
  });
  return { child, pair: child.stdio[4], line };
};
const within = (promise, ms, what) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} did not happen in time.`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

{
  const { child, pair, line } = startRuntime();
  const exchange = startSpawnerExchange();
  const reply = [];
  pair.on('data', (chunk) => reply.push(chunk));
  const ended = once(pair, 'end');
  pair.write(exchange.message);
  const { grandchild } = await within(line, 30_000, 'The pair runtime');
  await within(ended, 10_000, 'The end of the pair');
  assert.equal(Buffer.concat(reply).length, 64);
  assert.equal(alive(grandchild), true, 'the pair ended while a child of the runtime lived');
  exchange.complete(Buffer.concat(reply)).spawnerKey.wipe();
  process.kill(grandchild);
  child.kill();
}
{
  const { child, pair, line } = startRuntime();
  const completing = completeSpawnerPair(pair);
  const { grandchild, instanceKey } = await within(line, 30_000, 'The pair runtime');
  const { spawnerKey, instancePublicKey } = await within(completing, 10_000, 'The pair exchange');
  assert.equal(Buffer.from(instancePublicKey).toString('hex'), instanceKey);
  spawnerKey.wipe();
  process.kill(grandchild);
  child.kill();
}
console.log('pair OK');
