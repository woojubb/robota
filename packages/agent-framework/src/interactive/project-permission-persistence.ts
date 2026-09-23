import { createWorkspaceProjectSettingsStore } from '../config/settings-store.js';
import { createWorkspaceProjectSettingsWriter } from '../workspace-trust/project-settings-writer.js';

import type { IProjectSettingsPath } from '../config/settings-source.js';
import type { TWorkspaceProjectAccess } from '../workspace-trust/types.js';

/** Bind a host-selected local settings layer to the live project grant. */
export function createProjectPermissionPersistence(
  access: TWorkspaceProjectAccess | undefined,
  paths: readonly IProjectSettingsPath[] | undefined,
): ((scope: string) => void) | undefined {
  // The workspace mutation boundary currently has a stable root-anchored writer only on Linux.
  if (process.platform !== 'linux') return undefined;
  if (access?.status !== 'trusted') return undefined;
  const localPath = paths?.find((path) => path.scope === 'project-local');
  if (localPath === undefined) return undefined;

  return (scope: string): void => {
    // This callback runs only after the user chooses "allow for project" for this exact scope.
    const writer = createWorkspaceProjectSettingsWriter(access.authority, {
      status: 'approved',
      target: 'project-local',
      relativePath: localPath.relativePath,
      purpose: 'persist user-approved project permission',
    });
    const store = createWorkspaceProjectSettingsStore(access.authority, writer);
    const settings = store.read();
    const permissions =
      typeof settings.permissions === 'object' &&
      settings.permissions !== null &&
      !Array.isArray(settings.permissions)
        ? (settings.permissions as Record<string, unknown>)
        : {};
    const currentAllow = Array.isArray(permissions.allow)
      ? (permissions.allow as string[])
      : [];
    if (currentAllow.includes(scope)) return;
    store.write({
      ...settings,
      permissions: {
        ...permissions,
        allow: [...currentAllow, scope],
      },
    });
  };
}
