import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CLI_UPDATE_CACHE_TTL_MS,
  checkForCliUpdate,
  compareSemverVersions,
  formatCliUpdateCheckMessage,
  formatCliUpdateNotice,
  getUserUpdateCheckCachePath,
  isNewerSemverVersion,
  readUpdateCheckCache,
} from '../update-check.js';

const TEST_DIR = join(tmpdir(), `robota-update-check-test-${process.pid}`);

function cleanup(): void {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

describe('CLI update check version comparison', () => {
  it('orders stable releases after prereleases of the same version', () => {
    expect(compareSemverVersions('3.0.0', '3.0.0-beta.56')).toBeGreaterThan(0);
    expect(isNewerSemverVersion('3.0.0', '3.0.0-beta.56')).toBe(true);
  });

  it('orders prerelease numeric identifiers numerically', () => {
    expect(compareSemverVersions('3.0.0-beta.57', '3.0.0-beta.56')).toBeGreaterThan(0);
    expect(compareSemverVersions('3.0.0-beta.9', '3.0.0-beta.10')).toBeLessThan(0);
  });

  it('ignores build metadata during comparison', () => {
    expect(compareSemverVersions('3.0.0-beta.56+abc', '3.0.0-beta.56+def')).toBe(0);
  });
});

describe('checkForCliUpdate', () => {
  it('returns cached update notice when cache is fresh', async () => {
    cleanup();
    const cachePath = join(TEST_DIR, 'update-check.json');
    const now = new Date('2026-05-01T00:00:00.000Z');
    const fetchImpl = vi.fn(async () => jsonResponse({ 'dist-tags': { latest: '3.0.0-beta.57' } }));

    await checkForCliUpdate({
      currentVersion: '3.0.0-beta.56',
      cachePath,
      now,
      fetchImpl,
      force: true,
      timeoutMs: 10,
      registryUrl: 'https://registry.example.test',
      packageName: '@robota-sdk/agent-cli',
    });

    const result = await checkForCliUpdate({
      currentVersion: '3.0.0-beta.56',
      cachePath,
      now: new Date(now.getTime() + CLI_UPDATE_CACHE_TTL_MS - 1),
      fetchImpl,
      registryUrl: 'https://registry.example.test',
      packageName: '@robota-sdk/agent-cli',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('update_available');
    if (result.status !== 'update_available') throw new Error('expected update');
    expect(result.notice.latestVersion).toBe('3.0.0-beta.57');
  });

  it('skips registry access when disabled for the invocation', async () => {
    const fetchImpl = vi.fn();

    const result = await checkForCliUpdate({
      currentVersion: '3.0.0-beta.56',
      disabled: true,
      fetchImpl,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('writes only the operational cache file and does not create settings', async () => {
    cleanup();
    const cachePath = getUserUpdateCheckCachePath(TEST_DIR);
    const settingsPath = join(TEST_DIR, '.robota', 'settings.json');

    await checkForCliUpdate({
      currentVersion: '3.0.0-beta.56',
      cachePath,
      force: true,
      fetchImpl: async () => jsonResponse({ 'dist-tags': { latest: '3.0.0-beta.57' } }),
    });

    expect(existsSync(cachePath)).toBe(true);
    expect(existsSync(settingsPath)).toBe(false);
    expect(readUpdateCheckCache(cachePath)).toMatchObject({
      packageName: '@robota-sdk/agent-cli',
      currentVersion: '3.0.0-beta.56',
      latestVersion: '3.0.0-beta.57',
    });
  });

  it('returns an error result instead of throwing when the registry request fails', async () => {
    cleanup();
    const cachePath = join(TEST_DIR, 'update-check.json');

    const result = await checkForCliUpdate({
      currentVersion: '3.0.0-beta.56',
      cachePath,
      force: true,
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });

    expect(result.status).toBe('error');
    if (result.status !== 'error') throw new Error('expected error');
    expect(result.errorMessage).toContain('offline');
    expect(readFileSync(cachePath, 'utf8')).toContain('offline');
  });

  it('does not fail the update result when cache writing fails', async () => {
    cleanup();
    const cachePath = join(TEST_DIR, 'cache-as-directory');
    mkdirSync(cachePath, { recursive: true });

    const result = await checkForCliUpdate({
      currentVersion: '3.0.0-beta.56',
      cachePath,
      force: true,
      fetchImpl: async () => jsonResponse({ 'dist-tags': { latest: '3.0.0-beta.57' } }),
    });

    expect(result.status).toBe('update_available');
  });
});

describe('formatCliUpdateCheckMessage', () => {
  it('formats update notices with the install command', () => {
    const notice = {
      currentVersion: '3.0.0-beta.56',
      latestVersion: '3.0.0-beta.57',
      installCommand: "npm install -g '@robota-sdk/agent-cli@latest'",
    };

    expect(formatCliUpdateNotice(notice)).toContain(notice.installCommand);
    expect(formatCliUpdateCheckMessage({ status: 'update_available', notice })).toContain(
      '3.0.0-beta.57',
    );
  });

  it('formats registry failures without throwing', () => {
    expect(
      formatCliUpdateCheckMessage({
        status: 'error',
        errorMessage: 'registry unavailable',
      }),
    ).toContain('registry unavailable');
  });
});
