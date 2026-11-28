import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

/**
 * Where a paid run may keep its ledger and evidence. A ledger or an observation inside the
 * repository could be committed by accident, and one inside the system temporary directory can
 * vanish before the report is written, so a real run refuses both. Every path is resolved through
 * symlinks first (the nearest existing ancestor is resolved and the rest appended), so a link
 * cannot hide a location inside either tree.
 */

/** Resolves symlinks in the longest existing prefix of a path and appends the missing rest. */
export function resolveThroughLinks(path: string): string {
  const absolute = resolve(path);
  const missing: string[] = [];
  let current = absolute;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    missing.unshift(basename(current));
    current = parent;
  }
  const real = existsSync(current) ? realpathSync(current) : current;
  return join(real, ...missing);
}

/** True when `inner` is `outer` or below it. Both must already be resolved. */
export function isInside(outer: string, inner: string): boolean {
  const difference = relative(outer, inner);
  return difference === '' || (!difference.startsWith('..') && !isAbsolute(difference));
}

function git(directory: string, args: string[]): string | undefined {
  const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

/**
 * Every work tree of the repository that holds the example: the one that contains it, and the main
 * checkout when this is a linked work tree. When git cannot answer, the three directories above the
 * example stand in for the repository root.
 */
export function repositoryRoots(exampleDir: string): string[] {
  const roots = new Set<string>();
  const top = git(exampleDir, ['rev-parse', '--show-toplevel']);
  if (top === undefined || top === '') {
    roots.add(resolveThroughLinks(resolve(exampleDir, '..', '..', '..')));
    return [...roots];
  }
  roots.add(resolveThroughLinks(top));
  const common = git(exampleDir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (common !== undefined && common !== '' && basename(common) === '.git') {
    roots.add(resolveThroughLinks(dirname(common)));
  }
  return [...roots];
}

/** The system temporary directory in every spelling the host knows. */
export function temporaryRoots(): string[] {
  const roots = new Set<string>([resolveThroughLinks(tmpdir())]);
  for (const candidate of ['/tmp', '/var/tmp']) {
    if (existsSync(candidate)) roots.add(resolveThroughLinks(candidate));
  }
  return [...roots];
}

export interface IPathPolicy {
  /** The example's own directory, used to find the repository. */
  readonly exampleDir: string;
  /** A real run refuses the system temporary directory; a dry run and tests may allow it. */
  readonly allowTemporary: boolean;
}

export class PathGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathGuardError';
  }
}

/**
 * Returns the resolved path, or throws when a path that must stay out of the repository (and, for
 * a real run, out of the temporary directory) is inside either.
 */
export function assertEvidencePath(path: string, label: string, policy: IPathPolicy): string {
  if (path.trim() === '') throw new PathGuardError(`The ${label} path is empty`);
  const resolved = resolveThroughLinks(path);
  for (const root of repositoryRoots(policy.exampleDir)) {
    if (isInside(root, resolved)) {
      throw new PathGuardError(`The ${label} must be outside the repository`);
    }
  }
  if (!policy.allowTemporary) {
    for (const root of temporaryRoots()) {
      if (isInside(root, resolved)) {
        throw new PathGuardError(
          `The ${label} must not be inside the system temporary directory for a real run`,
        );
      }
    }
  }
  return resolved;
}

/** A credential file inside the repository is refused too: it would be one commit from public. */
export function assertCredentialPath(path: string, policy: IPathPolicy): string {
  const resolved = resolveThroughLinks(path);
  for (const root of repositoryRoots(policy.exampleDir)) {
    if (isInside(root, resolved)) {
      throw new PathGuardError('The credential file must be outside the repository');
    }
  }
  return resolved;
}
