import { describe, expect, it } from 'vitest';

import { authorityError, StableFileAuthorityError } from '../contracts.js';
import { WindowsStableFileHostBackend } from '../windows-backend.js';

import type { TNativeHandle } from '../windows-native-api.js';

interface IEntry {
  readonly id: bigint;
  name: string;
  deleted?: boolean;
  content?: string;
}

const ROOT = BigInt(1);
const PARENT = BigInt(2);
const ORIGINAL = BigInt(3);
const TEMPORARY = BigInt(4);
const ATTACKER = BigInt(5);

function backendWithNative(native: object): WindowsStableFileHostBackend {
  const backend = Object.create(
    WindowsStableFileHostBackend.prototype,
  ) as WindowsStableFileHostBackend;
  Reflect.set(backend, 'native', native);
  Reflect.set(backend, 'rootHandle', ROOT);
  Reflect.set(backend, 'rootIdentity', { volume: BigInt(1), fileId: BigInt(1) });
  return backend;
}

function fakeNative(entries: Map<TNativeHandle, IEntry>, parentReachable: () => boolean) {
  const identity = (handle: TNativeHandle) => {
    if (handle === ROOT) return { volume: BigInt(1), fileId: BigInt(1) };
    if (handle === PARENT) return { volume: BigInt(1), fileId: BigInt(2) };
    const entry = entries.get(handle);
    if (!entry) throw new Error('unknown fixture handle');
    return { volume: BigInt(1), fileId: entry.id };
  };
  const named = (name: string): TNativeHandle | undefined =>
    [...entries].find(([, entry]) => !entry.deleted && entry.name === name)?.[0];
  return {
    queryIdentity: (handle: TNativeHandle) => identity(handle),
    openOrCreateDirectory: () => PARENT,
    openReplacementTarget: () => named('note.txt'),
    createTemporaryFile: (_parent: TNativeHandle, name: string) => {
      entries.set(TEMPORARY, { id: BigInt(4), name });
      return TEMPORARY;
    },
    writeUtf8: (handle: TNativeHandle, content: string) => {
      entries.get(handle)!.content = content;
    },
    openRelative: (parent: TNativeHandle, name: string) => {
      if (parent === ROOT && name === 'parent') return parentReachable() ? PARENT : undefined;
      return named(name);
    },
    renameTo: (
      handle: TNativeHandle,
      _parent: TNativeHandle,
      name: string,
      replaceExisting: boolean,
    ) => {
      const collision = named(name);
      if (!replaceExisting && collision !== undefined && collision !== handle) {
        throw authorityError('FILE_CHANGED', 'fixture-rename');
      }
      entries.get(handle)!.name = name;
    },
    markForDeletion: (handle: TNativeHandle) => {
      entries.get(handle)!.deleted = true;
    },
    close: () => {},
  };
}

describe('Windows rooted writer race handling', () => {
  it('does not overwrite a target substituted after the original was inspected', () => {
    const entries = new Map<TNativeHandle, IEntry>([
      [ORIGINAL, { id: BigInt(3), name: 'note.txt', content: 'original' }],
    ]);
    const backend = backendWithNative(fakeNative(entries, () => true));

    expect(() =>
      backend.writeUtf8(['note.txt'], 'replacement', {
        afterTemporaryWritten: () => {
          entries.get(ORIGINAL)!.name = 'moved-original';
          entries.set(ATTACKER, { id: BigInt(5), name: 'note.txt', content: 'attacker' });
        },
      }),
    ).toThrow(StableFileAuthorityError);

    expect(entries.get(ATTACKER)).toMatchObject({ name: 'note.txt', content: 'attacker' });
    expect(entries.get(ORIGINAL)?.name).toMatch(/^\.atomic-backup-/u);
    expect(entries.get(TEMPORARY)?.deleted).toBe(true);
  });

  it('restores the original after the retained parent moves outside the root', () => {
    let reachable = true;
    const entries = new Map<TNativeHandle, IEntry>([
      [ORIGINAL, { id: BigInt(3), name: 'note.txt', content: 'original' }],
    ]);
    const backend = backendWithNative(fakeNative(entries, () => reachable));

    expect(() =>
      backend.writeUtf8(['parent', 'note.txt'], 'replacement', {
        afterPreCommitValidated: () => {
          reachable = false;
        },
      }),
    ).toThrow(StableFileAuthorityError);

    expect(entries.get(ORIGINAL)).toMatchObject({ name: 'note.txt', content: 'original' });
    expect(entries.get(TEMPORARY)?.deleted).toBe(true);
    expect(entries.get(TEMPORARY)?.name).toMatch(/^\.atomic-tmp-/u);
  });
});
