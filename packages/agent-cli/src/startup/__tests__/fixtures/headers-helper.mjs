// A header helper for tests. The first argument picks the behaviour.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const mode = process.argv[2] ?? 'ok';

if (mode === 'ok') {
  // Counts its runs in its cwd, so a test can tell a cached header from a fresh one.
  const count = existsSync('runs') ? Number(readFileSync('runs', 'utf8')) + 1 : 1;
  writeFileSync('runs', String(count));
  process.stderr.write('stderr-secret-text\n');
  process.stdout.write(
    JSON.stringify({
      Authorization: `Bearer helper-run-${count}`,
      'X-Server': process.env.ROBOTA_MCP_SERVER_NAME ?? '',
    }) + '\n',
  );
} else if (mode === 'env') {
  process.stdout.write(
    JSON.stringify({ 'X-Env': Object.keys(process.env).sort().join(','), 'X-Cwd': process.cwd() }),
  );
} else if (mode === 'fail') {
  process.stderr.write('stderr-secret-text\n');
  process.stdout.write('stdout-secret-text');
  process.exit(3);
} else if (mode === 'large') {
  process.stdout.write('x'.repeat(70 * 1024));
} else if (mode === 'hang') {
  // Leaves a grandchild behind, recording its pid, to prove the whole tree is killed.
  const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  writeFileSync(process.argv[3], String(grandchild.pid));
  setInterval(() => {}, 1000);
}
