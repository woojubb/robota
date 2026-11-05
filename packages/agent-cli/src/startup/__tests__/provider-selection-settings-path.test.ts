import { expect, it } from 'vitest';

import { providerSelectionSettingsPath } from '../command-setup.js';

import type { IHostSettingsSource } from '@robota-sdk/agent-framework';

function source(path: string | undefined, read: () => string | undefined): IHostSettingsSource {
  return { kind: 'host', scope: 'user', displayName: path ?? 'non-file source', ...(path === undefined ? {} : { path }), read };
}

it('uses the last currentProvider declaration and the known fallback only when none declares it', () => {
  const user = source('/user/settings.json', () => '{"currentProvider":"a"}');
  const compatibility = source('/user/compat.json', () => '{"currentProvider":"b"}');
  const other = source('/user/other.json', () => '{"language":"en"}');
  expect(providerSelectionSettingsPath('/workspace', [user, compatibility, other], user)).toBe('/user/compat.json');
  expect(providerSelectionSettingsPath('/workspace', [other], user)).toBe('/user/settings.json');
});

it('does not guess a file when any source is unreadable, malformed or lacks a file path', () => {
  const user = source('/user/settings.json', () => '{"currentProvider":"a"}');
  const unreadable = source('/user/unreadable.json', () => { throw new Error('unreadable'); });
  const malformed = source('/user/malformed.json', () => '{"currentProvider":');
  const memory = source(undefined, () => '{"currentProvider":"b"}');
  expect(providerSelectionSettingsPath('/workspace', [user, unreadable], user)).toBeUndefined();
  expect(providerSelectionSettingsPath('/workspace', [user, malformed], user)).toBeUndefined();
  expect(providerSelectionSettingsPath('/workspace', [user, memory], user)).toBeUndefined();
});
