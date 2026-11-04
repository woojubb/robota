import type { IFileSystem } from '@robota-sdk/agent-core';

/**
 * The files a plugin component reads and writes through. REQUIRED, with no platform default.
 *
 * The plugin code is platform-neutral, so it cannot reach for the process's file system; whoever
 * composes it names the one it uses. A JavaScript consumer is not type-checked, so an omitted `fs`
 * would otherwise surface later as "cannot read properties of undefined" from inside a loader. Refuse
 * at construction instead, and say what to pass.
 */
export function requirePluginFileSystem(fs: unknown, owner: string): IFileSystem {
  if (typeof fs !== 'object' || fs === null) {
    throw new Error(
      `${owner} requires \`fs\`: the file system its plugins directory is read and written ` +
        'through. On Node pass `new NodeFileSystem()` from `@robota-sdk/agent-framework/node`.',
    );
  }
  return fs as IFileSystem;
}
