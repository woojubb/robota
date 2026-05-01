import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { compareSemverVersions, isNewerSemverVersion } from './semver-compare.js';

export const CLI_UPDATE_PACKAGE_NAME = '@robota-sdk/agent-cli';
export const CLI_UPDATE_REGISTRY_URL = 'https://registry.npmjs.org';
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
export const CLI_UPDATE_CACHE_TTL_MS =
  HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
export const CLI_UPDATE_TIMEOUT_MS = 1500;

const DEFAULT_INSTALL_COMMAND = "npm install -g '@robota-sdk/agent-cli@latest'";

export interface ICliUpdateNotice {
  currentVersion: string;
  latestVersion: string;
  installCommand: string;
}

export interface IUpdateCheckCache {
  packageName: string;
  checkedAt: string;
  currentVersion: string;
  latestVersion?: string;
  errorMessage?: string;
}

export type TCliUpdateCheckResult =
  | { status: 'skipped'; reason: 'disabled' }
  | { status: 'current'; currentVersion: string; latestVersion: string }
  | { status: 'update_available'; notice: ICliUpdateNotice }
  | { status: 'error'; errorMessage: string };

export interface ICheckForCliUpdateOptions {
  currentVersion: string;
  disabled?: boolean;
  force?: boolean;
  cachePath?: string;
  now?: Date;
  ttlMs?: number;
  timeoutMs?: number;
  registryUrl?: string;
  packageName?: string;
  fetchImpl?: typeof fetch;
}

interface INpmPackageMetadata {
  'dist-tags'?: {
    latest?: TJsonValue;
  };
}
export { compareSemverVersions, isNewerSemverVersion };

type TJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly TJsonValue[]
  | { readonly [key: string]: TJsonValue };

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
    return undefined;
  }
}

export function writeUpdateCheckCache(path: string, cache: IUpdateCheckCache): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache, null, 2) + '\n', 'utf8');
}

export async function checkForCliUpdate(
  options: ICheckForCliUpdateOptions,
): Promise<TCliUpdateCheckResult> {
  if (options.disabled === true) {
    return { status: 'skipped', reason: 'disabled' };
  }

  const packageName = options.packageName ?? CLI_UPDATE_PACKAGE_NAME;
  const cachePath = options.cachePath ?? getUserUpdateCheckCachePath();
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? CLI_UPDATE_CACHE_TTL_MS;

  if (options.force !== true) {
    const cached = readUpdateCheckCache(cachePath);
    if (cached !== undefined && isFreshCache(cached, now, ttlMs, packageName)) {
      return resultFromCache(cached, options.currentVersion);
    }
  }

  try {
    const latestVersion = await fetchLatestVersion({
      fetchImpl: options.fetchImpl ?? fetch,
      packageName,
      registryUrl: options.registryUrl ?? CLI_UPDATE_REGISTRY_URL,
      timeoutMs: options.timeoutMs ?? CLI_UPDATE_TIMEOUT_MS,
    });
    tryWriteUpdateCheckCache(cachePath, {
      packageName,
      checkedAt: now.toISOString(),
      currentVersion: options.currentVersion,
      latestVersion,
    });
    return resultFromLatestVersion(options.currentVersion, latestVersion);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    tryWriteUpdateCheckCache(cachePath, {
      packageName,
      checkedAt: now.toISOString(),
      currentVersion: options.currentVersion,
      errorMessage,
    });
    return { status: 'error', errorMessage };
  }
}

function tryWriteUpdateCheckCache(path: string, cache: IUpdateCheckCache): void {
  try {
    writeUpdateCheckCache(path, cache);
  } catch {
    // Update checks are best-effort startup UX; cache I/O must not break CLI startup.
  }
}

export async function getStartupCliUpdateNotice(
  options: ICheckForCliUpdateOptions,
): Promise<ICliUpdateNotice | undefined> {
  const result = await checkForCliUpdate(options);
  return result.status === 'update_available' ? result.notice : undefined;
}

export function formatCliUpdateNotice(notice: ICliUpdateNotice): string {
  return [
    `Robota update available: ${notice.currentVersion} -> ${notice.latestVersion}.`,
    `Run ${notice.installCommand}`,
  ].join(' ');
}

export function formatCliUpdateCheckMessage(result: TCliUpdateCheckResult): string {
  if (result.status === 'update_available') {
    return formatCliUpdateNotice(result.notice);
  }
  if (result.status === 'current') {
    return `Robota is up to date (${result.currentVersion}).`;
  }
  if (result.status === 'skipped') {
    return 'Robota update check skipped.';
  }
  return `Robota update check failed: ${result.errorMessage}`;
}

function resultFromCache(cache: IUpdateCheckCache, currentVersion: string): TCliUpdateCheckResult {
  if (cache.errorMessage !== undefined) {
    return { status: 'error', errorMessage: cache.errorMessage };
  }
  if (cache.latestVersion === undefined) {
    return { status: 'error', errorMessage: 'Cached update check has no latest version' };
  }
  return resultFromLatestVersion(currentVersion, cache.latestVersion);
}

function resultFromLatestVersion(
  currentVersion: string,
  latestVersion: string,
): TCliUpdateCheckResult {
  if (isNewerSemverVersion(latestVersion, currentVersion)) {
    return {
      status: 'update_available',
      notice: {
        currentVersion,
        latestVersion,
        installCommand: DEFAULT_INSTALL_COMMAND,
      },
    };
  }
  return { status: 'current', currentVersion, latestVersion };
}

function isFreshCache(
  cache: IUpdateCheckCache,
  now: Date,
  ttlMs: number,
  packageName: string,
): boolean {
  if (cache.packageName !== packageName) {
    return false;
  }
  const checkedAt = Date.parse(cache.checkedAt);
  if (!Number.isFinite(checkedAt)) {
    return false;
  }
  return now.getTime() - checkedAt < ttlMs;
}

async function fetchLatestVersion(options: {
  fetchImpl: typeof fetch;
  packageName: string;
  registryUrl: string;
  timeoutMs: number;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const packageUrl = buildPackageMetadataUrl(options.registryUrl, options.packageName);
    const response = await options.fetchImpl(packageUrl, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`registry responded with HTTP ${response.status}`);
    }
    const metadata = (await response.json()) as INpmPackageMetadata;
    const latest = metadata['dist-tags']?.latest;
    if (typeof latest !== 'string' || latest.trim().length === 0) {
      throw new Error('registry metadata is missing dist-tags.latest');
    }
    return latest;
  } finally {
    clearTimeout(timeout);
  }
}

function buildPackageMetadataUrl(registryUrl: string, packageName: string): string {
  return `${registryUrl.replace(/\/+$/, '')}/${encodeURIComponent(packageName)}`;
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
