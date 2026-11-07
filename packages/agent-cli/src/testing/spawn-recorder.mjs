/** Test preload: refuse any Node child-process call until the spawner descriptor has closed. */
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

let pairClosed = false;
const close = fs.closeSync;
fs.closeSync = function (fd) {
  const result = close.call(fs, fd);
  if (fd === 4 && !pairClosed) {
    pairClosed = true;
    fs.writeSync(2, 'TEST_SPAWNER_PAIR_CLOSED\n');
  }
  return result;
};
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  const original = childProcess[name];
  childProcess[name] = function (...args) {
    if (!pairClosed) throw new Error('A child was started before the spawner pair closed.');
    return Reflect.apply(original, childProcess, args);
  };
}
syncBuiltinESMExports();
