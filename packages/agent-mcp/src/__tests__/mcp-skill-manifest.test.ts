import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { parseSkillEntry, verifySkillResource } from '../skills/manifest.js';

const identity = {
  serverId: 'server-a',
  serverName: 'fixture',
  serverVersion: '1',
  protocolVersion: '2026-07-28',
  catalogGeneration: 'carrier-a',
};
const uri = 'skill://team/demo/SKILL.md';
const text = '日本語';
const resource = (file = uri, value = text) => ({
  uri: file,
  size: Buffer.byteLength(value),
  digest: `sha256:${createHash('sha256').update(value).digest('hex')}`,
});
const entry = (resources: unknown = [resource()]) => ({
  uri,
  frontmatter: { name: 'demo', description: 'Use demo', metadata: { untouched: [true, null, 7] } },
  resources,
});

it('preserves complete frontmatter and fingerprints equivalent JSON and file ordering identically', () => {
  const first = parseSkillEntry(
    entry([resource(), resource('skill://team/demo/references/a.md')]),
    identity,
  );
  const second = parseSkillEntry(
    {
      ...entry([resource('skill://team/demo/references/a.md'), resource()]),
      frontmatter: {
        metadata: { untouched: [true, null, 7] },
        description: 'Use demo',
        name: 'demo',
      },
    },
    identity,
  );
  expect(first.manifestFingerprint).toBe(second.manifestFingerprint);
  expect(first.frontmatter).toEqual(entry().frontmatter);
  expect(first.identity).toEqual(identity);
});

it('supports other schemes and nested SKILL.md as ordinary supporting files', () => {
  const otherUri = 'github://owner/repo/demo/SKILL.md';
  expect(
    parseSkillEntry(
      {
        ...entry([resource(otherUri), resource('github://owner/repo/demo/child/SKILL.md')]),
        uri: otherUri,
      },
      identity,
    ).resources,
  ).toHaveLength(2);
});

it.each(
  [
    [resource(), resource()],
    [resource('skill://other/SKILL.md')],
    [resource(), resource('skill://team/demo/../other/file.md')],
    [resource(), resource('skill://team/demo/%2e%2e/other/file.md')],
    [resource(), resource('skill://team/demo/')],
    [{ ...resource(), size: -1 }],
    [{ ...resource(), size: 0.5 }],
    [{ ...resource(), size: 16 * 1024 * 1024 + 1 }],
    [{ ...resource(), digest: 'sha256:BAD' }],
    [],
  ].map((resources) => [resources]),
)('refuses incomplete, duplicate, escaping or malformed manifest resources: %j', (resources) => {
  expect(() => parseSkillEntry(entry(resources), identity)).toThrow(/invalid-manifest/);
});

it('supports 512 files totaling 16 MiB and refuses one more file', () => {
  const resources = Array.from({ length: 512 }, (_, index) => ({
    ...resource(index === 0 ? uri : `skill://team/demo/${index}.md`),
    size: 32 * 1024,
  }));
  expect(parseSkillEntry(entry(resources), identity).resources).toHaveLength(512);
  expect(() =>
    parseSkillEntry(entry([...resources, resource('skill://team/demo/513.md')]), identity),
  ).toThrow(/invalid-manifest/);
});

it('verifies raw UTF-8 and binary bytes instead of character or base64 counts', () => {
  const skill = parseSkillEntry(entry(), identity);
  expect(verifySkillResource(skill, uri, { uri, text })).toMatchObject({ size: 9, text });
  expect(
    verifySkillResource(skill, uri, { uri, blob: Buffer.from(text).toString('base64') }),
  ).toMatchObject({ size: 9 });
  expect(() => verifySkillResource(skill, uri, { uri, text: '別の文' })).toThrow(/digest-mismatch/);
});

it.each([
  { text, blob: 42 },
  { text: 42, blob: Buffer.from(text).toString('base64') },
  { text, blob: '' },
  { blob: '%%%bad' },
])('refuses malformed resource unions and encodings: %j', (payload) => {
  expect(() =>
    verifySkillResource(parseSkillEntry(entry(), identity), uri, { uri, ...payload }),
  ).toThrow(/invalid-resource/);
});

it('keeps dynamic manifests explicit and refuses verified reads', () => {
  const skill = parseSkillEntry(entry('dynamic'), identity);
  expect(skill.resources).toBe('dynamic');
  expect(() => verifySkillResource(skill, uri, { uri, text })).toThrow(/unsupported-dynamic/);
});
