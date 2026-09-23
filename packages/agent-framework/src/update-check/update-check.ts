import {
  getUserUpdateCheckCachePath,
  readUpdateCheckCache,
  writeUpdateCheckCache,
} from './update-check-cache.js';
import { compareSemverVersions, isNewerSemverVersion } from '../utils/semver-compare.js';
import { trimTrailingChars } from '../utils/trim-char.js';

import type { IUpdateCheckCache, TJsonValue } from './update-check-cache.js';

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

export interface IStartupCliUpdatePolicyInput {
  printMode: boolean;
  disableUpdateCheck: boolean;
}

interface INpmPackageMetadata {
  'dist-tags'?: {
    latest?: TJsonValue;
  };
}
export { compareSemverVersions, isNewerSemverVersion };

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

  const latestVersion = await fetchLatestVersionOrError(options, packageName, cachePath, now);
  if (typeof latestVersion !== 'string') {
    return latestVersion;
  }
  return resultFromLatestVersion(options.currentVersion, latestVersion);
}

async function fetchLatestVersionOrError(
  options: ICheckForCliUpdateOptions,
  packageName: string,
  cachePath: string,
  now: Date,
): Promise<string | TCliUpdateCheckResult> {
  const result = await attemptFetchLatestVersion({
    fetchImpl: options.fetchImpl ?? fetch,
    packageName,
    registryUrl: options.registryUrl ?? CLI_UPDATE_REGISTRY_URL,
    timeoutMs: options.timeoutMs ?? CLI_UPDATE_TIMEOUT_MS,
  });
  if (result.ok) {
    tryWriteUpdateCheckCache(cachePath, {
      packageName,
      checkedAt: now.toISOString(),
      currentVersion: options.currentVersion,
      latestVersion: result.version,
    });
    return result.version;
  }
  tryWriteUpdateCheckCache(cachePath, {
    packageName,
    checkedAt: now.toISOString(),
    currentVersion: options.currentVersion,
    errorMessage: result.errorMessage,
  });
  return { status: 'error', errorMessage: result.errorMessage };
}

function tryWriteUpdateCheckCache(path: string, cache: IUpdateCheckCache): void {
  try {
    writeUpdateCheckCache(path, cache);
  } catch {
    // allow-fallback: update cache I/O must not break CLI startup
  }
}

export async function getStartupCliUpdateNotice(
  options: ICheckForCliUpdateOptions,
): Promise<ICliUpdateNotice | undefined> {
  const result = await checkForCliUpdate(options);
  return result.status === 'update_available' ? result.notice : undefined;
}

export function shouldRunStartupCliUpdateCheck(input: IStartupCliUpdatePolicyInput): boolean {
  return input.printMode === false && input.disableUpdateCheck === false;
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

type TFetchResult = { ok: true; version: string } | { ok: false; errorMessage: string };

async function attemptFetchLatestVersion(options: {
  fetchImpl: typeof fetch;
  packageName: string;
  registryUrl: string;
  timeoutMs: number;
}): Promise<TFetchResult> {
  try {
    const version = await fetchLatestVersion(options);
    return { ok: true, version };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { ok: false, errorMessage };
  }
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
  // `trimTrailingChars` rather than `/\/+$/`: an unanchored trailing-run regex is quadratic (SEC-003).
  return `${trimTrailingChars(registryUrl, '/')}/${encodeURIComponent(packageName)}`;
}
