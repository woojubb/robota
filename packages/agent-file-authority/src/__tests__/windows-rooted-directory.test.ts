import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { WindowsNativeAuthority } from '../windows-native-authority.js';

import {
  listWindowsRootedDirectory,
  listWindowsRootedDirectoryForTest,
} from '../windows-rooted-directory.js';

const roots: string[] = [];
function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'windows-rooted-list-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.runIf(process.platform === 'win32')('Windows rooted directory listing', () => {
  it('lists root and nested files, and treats an absent path as empty', () => {
    const root = temporaryRoot();
    mkdirSync(join(root, 'nested'));
    writeFileSync(join(root, 'nested', 'inside.txt'), 'inside');
    expect(listWindowsRootedDirectory(root, [])).toContainEqual({
      name: 'nested',
      kind: 'directory',
    });
    expect(listWindowsRootedDirectory(root, ['nested'])).toContainEqual({
      name: 'inside.txt',
      kind: 'file',
    });
    expect(listWindowsRootedDirectory(root, ['missing'])).toEqual([]);
  });

  it('refuses final and intermediate directory junctions', () => {
    const root = temporaryRoot();
    const outside = temporaryRoot();
    mkdirSync(join(outside, 'nested'));
    symlinkSync(outside, join(root, 'junction'), 'junction');
    expect(() => listWindowsRootedDirectory(root, ['junction'])).toThrow();
    expect(() => listWindowsRootedDirectory(root, ['junction', 'nested'])).toThrow();
  });

  it('does not enumerate an outside directory during an intermediate junction ABA', () => {
    const root = temporaryRoot();
    const outside = temporaryRoot();
    mkdirSync(join(root, 'parent', 'child'), { recursive: true });
    mkdirSync(join(outside, 'child'));
    writeFileSync(join(root, 'parent', 'child', 'inside.txt'), 'inside');
    writeFileSync(join(outside, 'child', 'outside.txt'), 'outside');
    const result = listWindowsRootedDirectoryForTest(root, ['parent', 'child'], {
      afterDirectoryOpened: (index) => {
        if (index !== 0) return;
        renameSync(join(root, 'parent'), join(root, 'saved'));
        symlinkSync(outside, join(root, 'parent'), 'junction');
      },
      afterDirectoryEnumerated: () => {
        rmSync(join(root, 'parent'));
        renameSync(join(root, 'saved'), join(root, 'parent'));
      },
    });
    expect(result).toContainEqual({ name: 'inside.txt', kind: 'file' });
    expect(result.map((entry) => entry.name)).not.toContain('outside.txt');
  });

  it('refuses a target directory replaced after it was enumerated', () => {
    const root = temporaryRoot();
    mkdirSync(join(root, 'target'));
    mkdirSync(join(root, 'replacement'));
    expect(() =>
      listWindowsRootedDirectoryForTest(root, ['target'], {
        afterDirectoryEnumerated: () => {
          renameSync(join(root, 'target'), join(root, 'old'));
          renameSync(join(root, 'replacement'), join(root, 'target'));
        },
      }),
    ).toThrow();
  });

  it.each(['volume', 'fileId'] as const)(
    'rejects a changed %s in the full native directory identity',
    (field) => {
      const root = temporaryRoot();
      mkdirSync(join(root, 'child'));
      const original = WindowsNativeAuthority.prototype.queryIdentity;
      const spy = vi
        .spyOn(WindowsNativeAuthority.prototype, 'queryIdentity')
        .mockImplementation(function (this: WindowsNativeAuthority, handle, operation) {
          const identity = original.call(this, handle, operation);
          if (operation !== 'reinspect-directory') return identity;
          return field === 'volume'
            ? { ...identity, volume: identity.volume + 1n }
            : {
                ...identity,
                fileId: `${identity.fileId.startsWith('0') ? '1' : '0'}${identity.fileId.slice(1)}`,
              };
        });
      try {
        expect(() => listWindowsRootedDirectory(root, ['child'])).toThrow();
      } finally {
        spy.mockRestore();
      }
    },
  );

  it('closes retained handles after directory enumeration fails', () => {
    const base = temporaryRoot();
    const root = join(base, 'root');
    mkdirSync(join(root, 'child'), { recursive: true });
    const spy = vi
      .spyOn(WindowsNativeAuthority.prototype, 'readDirectory')
      .mockImplementation(() => {
        throw new Error('synthetic enumeration failure');
      });
    try {
      expect(() => listWindowsRootedDirectory(root, ['child'])).toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(() => renameSync(root, join(base, 'moved'))).not.toThrow();
  });

  it('keeps every ancestor of the trusted root from being redirected', () => {
    const base = temporaryRoot();
    const ancestor = join(base, 'ancestor');
    const root = join(ancestor, 'root');
    mkdirSync(join(root, 'child'), { recursive: true });
    let blocked = false;
    listWindowsRootedDirectoryForTest(root, ['child'], {
      afterDirectoryOpened: () => {
        try {
          renameSync(ancestor, join(base, 'moved'));
        } catch {
          blocked = true;
        }
      },
    });
    expect(blocked).toBe(true);
  });

  it('fails closed for unverified UNC roots', () => {
    expect(() => listWindowsRootedDirectory('\\\\server\\share\\workspace', [])).toThrow();
  });

  it('keeps the trusted root name from being replaced while it is open', () => {
    const base = temporaryRoot();
    const root = join(base, 'root');
    mkdirSync(join(root, 'child'), { recursive: true });
    let blocked = false;
    listWindowsRootedDirectoryForTest(root, ['child'], {
      afterDirectoryOpened: () => {
        try {
          renameSync(root, join(base, 'moved'));
        } catch {
          blocked = true;
        }
      },
    });
    expect(blocked).toBe(true);
  });
});
