import { posix, win32 } from 'node:path';

import { describe, expect, it } from 'vitest';

import { settingsCheckId } from '../doctor-settings-probe.js';

import type { TSettingsSource } from '@robota-sdk/agent-framework';

const hostSource = (path: string): TSettingsSource =>
  ({ kind: 'host', scope: 'user', path }) as unknown as TSettingsSource;
const projectSource = (relativePath: string): TSettingsSource =>
  ({ kind: 'project', scope: 'project', relativePath }) as unknown as TSettingsSource;

/** What the id was when `node:path` read the directory name, for the platform the path belongs to. */
function nodeFamily(path: string, flavour: typeof posix | typeof win32): string {
  return flavour.basename(flavour.dirname(path)).replace(/^\./, '');
}

describe('settings check id', () => {
  it.each([
    ['/home/user/.robota/settings.json', 'robota'],
    ['/home/user/.claude/settings.json', 'claude'],
    ['/settings.json', ''],
    ['settings.json', ''],
    ['sub/dir/settings.json', 'dir'],
  ])('names the directory of the POSIX host path %s, as node:path does', (path, family) => {
    expect(settingsCheckId(hostSource(path))).toBe(`settings.user.${family}`);
    expect(family).toBe(nodeFamily(path, posix));
  });

  it.each([
    ['C:\\Users\\user\\.robota\\settings.json', 'robota'],
    ['C:/Users/user/.claude/settings.json', 'claude'],
    ['\\\\server\\share\\.robota\\settings.json', 'robota'],
  ])('names the directory of the Windows host path %s, as node:path does', (path, family) => {
    expect(settingsCheckId(hostSource(path))).toBe(`settings.user.${family}`);
    expect(family).toBe(nodeFamily(path, win32));
  });

  it('reads a project-relative path a Windows host joined with `\\` as it reads one joined with `/`', () => {
    // `join('.robota', 'settings.json')` is `.robota\settings.json` on Windows. A helper that takes the
    // platform from the text would see one POSIX name there and lose the directory.
    expect(settingsCheckId(projectSource('.robota\\settings.json'))).toBe(
      'settings.project.robota',
    );
    expect(settingsCheckId(projectSource('.robota/settings.json'))).toBe('settings.project.robota');
    expect(nodeFamily('.robota\\settings.json', win32)).toBe('robota');
  });
});
