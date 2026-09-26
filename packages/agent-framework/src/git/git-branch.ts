import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const DETACHED_HEAD_LENGTH = 7;

/** Explicit host-filesystem Git metadata adapter. This does not establish project trust. */
export function resolveGitBranchFromNodeHost(cwd: string): string | undefined {
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
    // allow-fallback: git I/O failures are non-fatal; return undefined to skip branch display
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

/** Open errors that mean there is no usable `.git` entry here, so the search moves on. */
const NO_METADATA_CODES: ReadonlySet<string> = new Set([
  'ENOENT',
  'ENOTDIR',
  'ELOOP',
  'EMLINK',
  'ENXIO',
  'EOPNOTSUPP',
]);

function isDirectoryEntry(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * A `.git` directory, or a `.git` file's `gitdir:` target; a link or anything else is ignored.
 * The entry is opened once without following a link and checked on that descriptor, so what is
 * read is exactly what was checked.
 */
function resolveGitMetadata(candidate: string, repoDir: string): string | undefined {
  let fd: number;
  try {
    fd = openSync(candidate, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    // A platform that cannot open a directory says so; a directory is what is looked for.
    if (code === 'EISDIR') return candidate;
    if (NO_METADATA_CODES.has(code)) return undefined;
    // A `.git` directory that can be entered but not listed still holds a readable HEAD; nothing
    // is read through this entry itself, so its type is all that is asked. An entry that cannot
    // even be looked at is no metadata here, and the search moves on to the parent.
    if (code === 'EACCES' || code === 'EPERM')
      return isDirectoryEntry(candidate) ? candidate : undefined;
    throw error;
  }

  let content: string;
  try {
    // Windows has no O_NOFOLLOW (the constant is absent, so the open above follows a link). Ask
    // the path once more and ignore a link, as the flag does elsewhere. This second look is not
    // bound to the descriptor, so a link swapped in after it is only caught on POSIX; `.git`
    // links are not a Windows repository layout, so this is a best effort there.
    if (process.platform === 'win32' && lstatSync(candidate).isSymbolicLink()) return undefined;
    const stat = fstatSync(fd);
    if (stat.isDirectory()) return candidate;
    if (!stat.isFile()) return undefined;
    content = readFileSync(fd, 'utf8').trim();
  } finally {
    closeSync(fd);
  }

  const prefix = 'gitdir:';
  if (!content.startsWith(prefix)) return undefined;
  const rawPath = content.slice(prefix.length).trim();
  return isAbsolute(rawPath) ? rawPath : resolve(repoDir, rawPath);
}
