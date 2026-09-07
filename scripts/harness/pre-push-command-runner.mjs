import { spawnSync } from 'node:child_process';

export function createPrePushCommandRunner({
  root,
  spawn = spawnSync,
  write = process.stdout.write.bind(process.stdout),
  exit = process.exit,
}) {
  return (command, args) => {
    write(`> ${[command, ...args].join(' ')}\n`);
    const result = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      encoding: 'utf8',
    });
    if (result.status !== 0) exit(result.status ?? 1);
  };
}
