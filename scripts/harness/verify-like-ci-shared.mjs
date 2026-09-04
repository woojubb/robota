import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

export const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

export function parseGitFileList(stdout) {
  return (stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function run(command, args, cwd = WORKSPACE_ROOT, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false, ...options });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (error) => {
      process.stderr.write(`${error?.message ?? error}\n`);
      resolve(1);
    });
  });
}

export function git(args) {
  const result = spawnSync('git', args, { cwd: WORKSPACE_ROOT, encoding: 'utf8' });
  return result.status === 0 ? parseGitFileList(result.stdout) : [];
}

export function gitOrThrow(args, cwd = WORKSPACE_ROOT) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${result.status}): ${result.stderr?.trim()}`);
  }
  return result.stdout ?? '';
}
