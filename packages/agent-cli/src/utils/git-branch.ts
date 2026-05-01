import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const DETACHED_HEAD_LENGTH = 7;

export function resolveGitBranch(cwd: string): string | undefined {
  try {
    const gitDir = findGitDir(cwd);
    if (!gitDir) return undefined;

    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
    if (!head) return undefined;
    if (head.startsWith('ref: ')) {
      const ref = head.slice('ref: '.length).trim();
      const branchPrefix = 'refs/heads/';
      return ref.startsWith(branchPrefix) ? ref.slice(branchPrefix.length) : ref;
    }
    return head.slice(0, DETACHED_HEAD_LENGTH);
  } catch {
    return undefined;
  }
}

function findGitDir(start: string): string | undefined {
  let current = resolve(start);
  let parent = dirname(current);

  while (parent !== current) {
    const candidate = join(current, '.git');
    const resolved = resolveGitMetadata(candidate, current);
    if (resolved) return resolved;

    current = parent;
    parent = dirname(current);
  }

  const rootCandidate = join(current, '.git');
  return resolveGitMetadata(rootCandidate, current);
}

function resolveGitMetadata(candidate: string, repoDir: string): string | undefined {
  if (!existsSync(candidate)) return undefined;
  const stat = lstatSync(candidate);
  if (stat.isDirectory()) return candidate;
  if (!stat.isFile()) return undefined;

  const content = readFileSync(candidate, 'utf8').trim();
  const prefix = 'gitdir:';
  if (!content.startsWith(prefix)) return undefined;
  const rawPath = content.slice(prefix.length).trim();
  return isAbsolute(rawPath) ? rawPath : resolve(repoDir, rawPath);
}
