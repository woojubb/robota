import { authorityError } from './contracts.js';
import { validateRelativeSegments, validateRootDirectory } from './input-validation.js';
import { WindowsNativeAuthority, type IWindowsIdentity } from './windows-native-authority.js';

import type { IStableRootedDirectoryEntry } from './contracts.js';
import type { TNativeHandle } from './windows-native-api.js';

export interface IWindowsDirectoryTestHooks {
  readonly afterDirectoryOpened?: (segmentIndex: number) => void;
  readonly afterDirectoryEnumerated?: () => void;
}

function sameIdentity(left: IWindowsIdentity, right: IWindowsIdentity): boolean {
  return left.volume === right.volume && left.fileId === right.fileId;
}

/** Reopen each name relative to the retained root and compare its full native identity. */
function assertNamedChain(
  native: WindowsNativeAuthority,
  root: string,
  segments: readonly string[],
  expected: readonly IWindowsIdentity[],
): void {
  const handles: TNativeHandle[] = [];
  try {
    const rootHandle = native.openRoot(root, true);
    handles.push(rootHandle);
    if (!sameIdentity(native.queryIdentity(rootHandle, 'reinspect-root'), expected[0])) {
      throw authorityError('ROOT_CHANGED', 'reinspect-root');
    }
    let parent = rootHandle;
    for (let index = 0; index < segments.length; index += 1) {
      const handle = native.openRelative(parent, segments[index], false, index);
      if (handle === undefined)
        throw authorityError('FILE_CHANGED', 'reinspect-directory', { segmentIndex: index });
      handles.push(handle);
      if (!sameIdentity(native.queryIdentity(handle, 'reinspect-directory'), expected[index + 1])) {
        throw authorityError('FILE_CHANGED', 'reinspect-directory', { segmentIndex: index });
      }
      parent = handle;
    }
  } finally {
    for (const handle of handles.reverse()) native.close(handle);
  }
}

function listDirectory(
  rootDirectory: string,
  relativeSegments: readonly string[],
  hooks: IWindowsDirectoryTestHooks,
): readonly IStableRootedDirectoryEntry[] {
  if (process.platform !== 'win32') throw authorityError('UNSUPPORTED_BACKEND', 'list-directory');
  const root = validateRootDirectory(rootDirectory);
  if (!Array.isArray(relativeSegments)) throw authorityError('INVALID_PATH', 'validate-segments');
  if (relativeSegments.length !== 0) validateRelativeSegments(relativeSegments);
  const native = new WindowsNativeAuthority();
  const handles: TNativeHandle[] = [];
  try {
    // Blocking delete-sharing prevents a named-root replacement while its identity is being checked.
    const rootHandle = native.openRoot(root, true);
    handles.push(rootHandle);
    const identities: IWindowsIdentity[] = [native.queryIdentity(rootHandle, 'inspect-root')];
    let parent = rootHandle;
    for (let index = 0; index < relativeSegments.length; index += 1) {
      const handle = native.openRelative(parent, relativeSegments[index], false, index);
      if (handle === undefined) {
        assertNamedChain(native, root, relativeSegments.slice(0, index), identities);
        return [];
      }
      handles.push(handle);
      identities.push(native.queryIdentity(handle, 'inspect-directory'));
      parent = handle;
      hooks.afterDirectoryOpened?.(index);
    }
    const entries = native.readDirectory(parent);
    hooks.afterDirectoryEnumerated?.();
    assertNamedChain(native, root, relativeSegments, identities);
    return entries;
  } finally {
    for (const handle of handles.reverse()) native.close(handle);
  }
}

/** List a Windows directory through a retained root-relative no-follow handle walk. */
export function listWindowsRootedDirectory(
  rootDirectory: string,
  relativeSegments: readonly string[],
): readonly IStableRootedDirectoryEntry[] {
  return listDirectory(rootDirectory, relativeSegments, {});
}

/** Internal-only seams for deterministic Windows path-replacement tests. */
export function listWindowsRootedDirectoryForTest(
  rootDirectory: string,
  relativeSegments: readonly string[],
  hooks: IWindowsDirectoryTestHooks,
): readonly IStableRootedDirectoryEntry[] {
  return listDirectory(rootDirectory, relativeSegments, hooks);
}
