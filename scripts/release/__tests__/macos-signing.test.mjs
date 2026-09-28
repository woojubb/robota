import { describe, expect, it, vi } from 'vitest';

import { notarizeArtifact, signRuntime, selectIdentity } from '../macos-signing.mjs';

describe('macOS release signing', () => {
  it('refuses a development certificate or a certificate belonging to another team', () => {
    const identities = [
      '1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Apple Development: Owner (TEAM123456)"',
      '2) BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB "Developer ID Application: Other (OTHER12345)"',
    ].join('\n');
    expect(() => selectIdentity(identities, 'TEAM123456')).toThrow(/Developer ID Application/);
  });

  it('selects the matching distribution identity', () => {
    expect(
      selectIdentity(
        '1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: Owner (TEAM123456)"',
        'TEAM123456',
      ),
    ).toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  });

  it('refuses to sign when the release identity is missing', () => {
    const run = vi.fn();
    expect(() => signRuntime('/tmp/robota', { env: {}, run })).toThrow(/MACOS_SIGNING_IDENTITY/);
    expect(run).not.toHaveBeenCalled();
  });

  it('signs the Bun runtime with its own entitlements and verifies the resulting bytes', () => {
    const run = vi.fn(() => '');
    signRuntime('/tmp/robota with spaces', {
      env: { MACOS_SIGNING_IDENTITY: 'identity', CSC_KEYCHAIN: '/tmp/keychain' },
      run,
    });
    expect(run.mock.calls[0][0]).toBe('codesign');
    expect(run.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        '--timestamp',
        '--options',
        'runtime',
        '--entitlements',
        '/tmp/robota with spaces',
      ]),
    );
    expect(run.mock.calls[1]).toEqual([
      'codesign',
      ['--verify', '--strict', '--verbose=2', '/tmp/robota with spaces'],
    ]);
  });

  it('refuses an Apple rejection even when notarytool exits successfully', () => {
    const run = vi.fn(() => JSON.stringify({ id: 'submission', status: 'Invalid' }));
    expect(() =>
      notarizeArtifact('/tmp/Robota.dmg', { env: { APPLE_KEYCHAIN_PROFILE: 'profile' }, run }),
    ).toThrow(/Invalid/);
    expect(run.mock.calls.some(([, args]) => args[0] === 'stapler')).toBe(false);
  });

  it('staples and validates a DMG only after Apple accepts it', () => {
    const run = vi.fn(() => JSON.stringify({ id: 'submission', status: 'Accepted' }));
    notarizeArtifact('/tmp/Robota.dmg', { env: { APPLE_KEYCHAIN_PROFILE: 'profile' }, run });
    expect(run.mock.calls.slice(1)).toEqual([
      ['xcrun', ['stapler', 'staple', '/tmp/Robota.dmg']],
      ['xcrun', ['stapler', 'validate', '/tmp/Robota.dmg']],
    ]);
  });

  it('does not try stapling a ZIP submission for a flat command-line executable', () => {
    const run = vi.fn(() => JSON.stringify({ id: 'submission', status: 'Accepted' }));
    notarizeArtifact('/tmp/robota.zip', { env: { APPLE_KEYCHAIN_PROFILE: 'profile' }, run });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('refuses missing notarization credentials instead of skipping the operation', () => {
    const run = vi.fn();
    expect(() => notarizeArtifact('/tmp/Robota.dmg', { env: {}, run })).toThrow(
      /APPLE_KEYCHAIN_PROFILE/,
    );
    expect(run).not.toHaveBeenCalled();
  });
});
