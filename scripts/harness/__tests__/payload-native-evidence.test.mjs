import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validatePayloadNativeEvidence } from '../payload-native-evidence.mjs';
import { makeTemp } from './make-temp.mjs';

const TARGETS = {
  'darwin-arm64': ['darwin', 'arm64'],
  'darwin-x64': ['darwin', 'x64'],
  'linux-arm64': ['linux', 'arm64'],
  'linux-x64': ['linux', 'x64'],
  'windows-x64': ['win32', 'x64'],
};

function writeEvidence(root, target, overrides = {}) {
  const [platform, arch] = TARGETS[target];
  writeFileSync(
    join(root, `evidence-${target}.json`),
    JSON.stringify({
      schemaVersion: 2,
      target,
      platform,
      arch,
      koffi: '3.3.1',
      node20: 'v20.19.5',
      node22: 'v22.14.0',
      bun: '1.3.14',
      rootReplacement: 'preserved',
      finalLink: 'refused',
      boundedRead: 'refused',
      sessionReplay: 'passed',
      packedNodeCli: 'passed',
      standaloneBunCli: 'passed',
      ...overrides,
    }),
  );
}

describe('stable payload native evidence fan-in', () => {
  it('accepts exactly one valid result for every native target', () => {
    const root = makeTemp('payload-native-evidence-');
    for (const target of Object.keys(TARGETS)) writeEvidence(root, target);
    expect(validatePayloadNativeEvidence(root)).toEqual(Object.keys(TARGETS).sort());
  });

  it('fails closed on missing, unexpected, duplicate-shaped, or invalid evidence', () => {
    const missing = makeTemp('payload-native-missing-');
    for (const target of Object.keys(TARGETS).slice(1)) writeEvidence(missing, target);
    expect(() => validatePayloadNativeEvidence(missing)).toThrow(/set mismatch/u);

    const invalid = makeTemp('payload-native-invalid-');
    for (const target of Object.keys(TARGETS)) writeEvidence(invalid, target);
    writeFileSync(join(invalid, 'unexpected.json'), '{}');
    expect(() => validatePayloadNativeEvidence(invalid)).toThrow(/set mismatch/u);

    const wrongHost = makeTemp('payload-native-wrong-host-');
    for (const target of Object.keys(TARGETS)) writeEvidence(wrongHost, target);
    writeEvidence(wrongHost, 'linux-x64', { arch: 'arm64' });
    expect(() => validatePayloadNativeEvidence(wrongHost)).toThrow(/invalid arch/u);

    const nested = makeTemp('payload-native-nested-');
    mkdirSync(join(nested, 'artifact'));
    expect(() => validatePayloadNativeEvidence(nested)).toThrow(/set mismatch/u);
  });
});
