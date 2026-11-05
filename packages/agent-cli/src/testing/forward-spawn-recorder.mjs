/** Test preload: only the intended forwarding spawn may happen before the inherited fd closes. */
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

let closed = false;
let forwarded = false;
const close = fs.closeSync;
fs.closeSync = function (fd) {
  const result = close.call(fs, fd);
  if (fd === 4 && !closed) { closed = true; fs.writeSync(2, 'TEST_FORWARD_FD_CLOSED\n'); }
  return result;
};
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  const original = childProcess[name];
  childProcess[name] = function (...args) {
    if (!closed) {
      const argv = args[1];
      const options = args[2];
      const target = name === 'spawn' && !forwarded && Array.isArray(argv) &&
        argv.includes('--supervised-spawner-pair') && Array.isArray(options?.stdio) && options.stdio[4] === 4;
      if (!target) {
        fs.writeSync(2, `TEST_PRE_FORWARD_SPAWN ${name}\n`);
        throw new Error('A child was started before the spawner pair was forwarded.');
      }
      forwarded = true;
    }
    return Reflect.apply(original, childProcess, args);
  };
}
syncBuiltinESMExports();
