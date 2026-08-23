import { dirname } from 'node:path';

import type { TInstalledPluginsRegistry } from './bundle-plugin-installer.js';
import type { IFileSystem } from '@robota-sdk/agent-core';

/**
 * Reading and writing `installed_plugins.json`.
 *
 * Split out of `bundle-plugin-installer.ts` under SEC-018 (issue #2020), by responsibility rather
 * than by line count: the installer decides WHAT to install and remove; this owns the persisted
 * record of what is installed. They fail differently — a corrupt registry is a recovery problem, a
 * failed install is a transaction problem — and separating them makes the trust boundary visible,
 * which is the point of SEC-018.
 *
 * **Everything this returns is a HINT, not a fact.** The file is on disk and can be tampered with, so
 * a caller must not treat `installPath` as a path it may act on. Both of this repository's recursive
 * deletes over that value now prove containment first; this module deliberately does no validation of
 * its own, so there is exactly one place — the sink — where the question is asked, rather than two
 * that can disagree about the answer.
 */
export function readInstalledPluginsRegistry(
  registryPath: string,
  fs: IFileSystem,
): TInstalledPluginsRegistry {
  if (!fs.existsSync(registryPath)) return {};
  try {
    const raw = fs.readFileSync(registryPath, 'utf-8');
    const data: unknown = JSON.parse(raw);
    if (typeof data === 'object' && data !== null) return data as TInstalledPluginsRegistry;
    return {};
  } catch {
    // allow-fallback: corrupt installed_plugins.json returns an empty registry to allow recovery
    return {};
  }
}

/** Persist the registry, creating its directory if needed. */
export function writeInstalledPluginsRegistry(
  registryPath: string,
  registry: TInstalledPluginsRegistry,
  fs: IFileSystem,
): void {
  const dir = dirname(registryPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
}
