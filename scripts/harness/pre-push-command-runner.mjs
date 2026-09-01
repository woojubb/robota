import { spawnSync } from 'node:child_process';

export function mergeChildEnvironment(overlay, inherited = process.env) {
  return { ...inherited, ...overlay };
}

export function createPrePushCommandRunner({
  root,
  spawn = spawnSync,
  inheritedEnvironment = process.env,
  write = process.stdout.write.bind(process.stdout),
  exit = process.exit,
}) {
  return (command, args, options = {}) => {
    write(`> ${[command, ...args].join(' ')}\n`);
    const result = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      encoding: 'utf8',
      ...(options.env ? { env: mergeChildEnvironment(options.env, inheritedEnvironment) } : {}),
    });
    if (result.status !== 0) exit(result.status ?? 1);
  };
}
