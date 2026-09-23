/**
 * Persistence for the CLI update-check cache: where it lives, how it is read, how it is written.
 *
 * Split out of `update-check.ts` under the anti-monolith ratchet — that file sits on its frozen
 * 305-line baseline, and routing the write through the owner-only writer (issue #2229) needed one
 * line more than it had. The cluster carved out here is the cohesive one: a path, a codec, and the
 * two IO calls, with the policy and formatting left behind.
 *
 * The write goes through `writeOwnerOnlyFile` because SEC-020 (issue #2021) made every writer into
 * the CLI's own store owner-only and scoped this one out, leaving it the single file created there
 * at 0644 under a permissive umask. The store directory is the confidentiality boundary; the file
 * mode is the layer beneath it, so it carries no exception. `writeOwnerOnlyFile` also creates the
 * parent owner-only and sets the mode at CREATION rather than chmod-ing after, so the file never
 * exists readable.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { writeOwnerOnlyFile } from '@robota-sdk/agent-core/node';

/** The JSON value shape this codec walks. Owned here because the cache is its only consumer pair. */
export type TJsonValue =
  string | number | boolean | null | readonly TJsonValue[] | { readonly [key: string]: TJsonValue };

export interface IUpdateCheckCache {
  packageName: string;
  checkedAt: string;
  currentVersion: string;
  latestVersion?: string;
  errorMessage?: string;
}
export function getUserUpdateCheckCachePath(
  home = process.env.HOME ?? process.env.USERPROFILE ?? '/',
): string {
  return join(home, '.robota', 'update-check.json');
}
export function readUpdateCheckCache(path: string): IUpdateCheckCache | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as TJsonValue;
    return parseUpdateCheckCache(parsed);
  } catch {
    // allow-fallback: corrupt cache must not block startup; silently discard and re-fetch
    return undefined;
  }
}
export function writeUpdateCheckCache(path: string, cache: IUpdateCheckCache): void {
  writeOwnerOnlyFile(path, JSON.stringify(cache, null, 2) + '\n');
}
function parseUpdateCheckCache(value: TJsonValue): IUpdateCheckCache | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const candidate = value;
  if (
    typeof candidate.packageName === 'string' &&
    typeof candidate.checkedAt === 'string' &&
    typeof candidate.currentVersion === 'string' &&
    (candidate.latestVersion === undefined || typeof candidate.latestVersion === 'string') &&
    (candidate.errorMessage === undefined || typeof candidate.errorMessage === 'string')
  ) {
    return {
      packageName: candidate.packageName,
      checkedAt: candidate.checkedAt,
      currentVersion: candidate.currentVersion,
      ...(candidate.latestVersion !== undefined && { latestVersion: candidate.latestVersion }),
      ...(candidate.errorMessage !== undefined && { errorMessage: candidate.errorMessage }),
    };
  }
  return undefined;
}
function isJsonObject(value: TJsonValue): value is { readonly [key: string]: TJsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
