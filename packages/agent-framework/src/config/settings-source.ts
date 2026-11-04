import { assertWorkspaceProjectReader } from '../workspace-trust/index.js';

import type { THostSettingsScope } from './settings-scope-types.js';
import type { IWorkspaceProjectReader } from '../workspace-trust/index.js';

export type { THostSettingsScope } from './settings-scope-types.js';
export type TProjectSettingsScope = 'project' | 'project-local';

/**
 * A managed or user-owned settings document the host reads through its own storage. A settings layer
 * is read through `read()`, never by path: a Node host passes `createNodeHostSettingsSource` from
 * `@robota-sdk/agent-framework/node`, a browser host passes its own `read`.
 */
export interface IHostSettingsSource {
  readonly kind: 'host';
  readonly scope: THostSettingsScope;
  /** What a diagnostic calls the document; a file-backed source uses its path. */
  readonly displayName: string;
  /**
   * The file the document lives in, when it is a file. Plugin enablement acts on the file itself
   * (the user source's `path` goes to the plugin settings store, so a user source without one
   * enables no plugins), and `doctor` names the file; a source over other storage omits it.
   */
  readonly path?: string;
  /**
   * The document's text, or `undefined` when it does not exist. A document that exists but cannot
   * be read throws, so a layer that is present and unreadable is never mistaken for an absent one.
   */
  read(): string | undefined;
}

export interface IWorkspaceProjectSettingsSource {
  readonly kind: 'project';
  readonly scope: TProjectSettingsScope;
  readonly displayName: string;
  readonly relativePath: string;
  readonly reader: IWorkspaceProjectReader;
}

export type TSettingsSource = IHostSettingsSource | IWorkspaceProjectSettingsSource;

export interface IProjectSettingsPath {
  readonly scope: TProjectSettingsScope;
  readonly relativePath: string;
}

/** Project layers bound to a runtime-accepted root-relative reader. */
export function createWorkspaceProjectSettingsSources(
  reader: IWorkspaceProjectReader,
  paths: readonly IProjectSettingsPath[],
): readonly IWorkspaceProjectSettingsSource[] {
  const accepted = assertWorkspaceProjectReader(reader);
  return paths.map(({ scope, relativePath }) =>
    Object.freeze({
      kind: 'project' as const,
      scope,
      displayName: relativePath,
      relativePath,
      reader: accepted,
    }),
  );
}

export function readSettingsSourceText(
  source: TSettingsSource,
  purpose: string,
): string | undefined {
  if (source.kind === 'host') {
    if (typeof source.read !== 'function') {
      throw new TypeError(
        `Host settings source "${source.displayName}" has no read(). A host source supplies its own ` +
          'reader; on Node use createNodeHostSettingsSource from @robota-sdk/agent-framework/node.',
      );
    }
    return source.read();
  }
  return assertWorkspaceProjectReader(source.reader).readText(source.relativePath, purpose);
}
