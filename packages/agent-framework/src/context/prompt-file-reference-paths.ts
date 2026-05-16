import { homedir } from 'node:os';
import { isAbsolute, relative as pathRelative, resolve, sep as pathSeparator } from 'node:path';

export function resolveCandidatePath(referencePath: string, rootPath: string): string {
  if (referencePath.startsWith('~/')) {
    return resolve(homedir(), referencePath.slice('~/'.length));
  }
  if (isAbsolute(referencePath)) {
    return resolve(referencePath);
  }
  return resolve(rootPath, referencePath);
}

export function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = pathRelative(rootPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

export function normalizeRelativePath(rootPath: string, sourcePath: string): string {
  return pathRelative(rootPath, sourcePath).split(pathSeparator).join('/');
}
