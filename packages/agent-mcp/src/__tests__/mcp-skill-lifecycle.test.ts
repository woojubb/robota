import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createSkillsSession } from '../skills/session.js';
import type { Result } from '@modelcontextprotocol/sdk/types.js';

const identity = {
  serverId: 'a',
  serverName: 'server',
  serverVersion: '1',
  protocolVersion: '2026-07-28',
  catalogGeneration: 'generation-a',
};
const uri = 'skill://demo/SKILL.md';
const content = 'content';
const entry = {
  uri,
  frontmatter: { name: 'demo', description: 'Use demo' },
  resources: [
    {
      uri,
      size: Buffer.byteLength(content),
      digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    },
  ],
};
const base = { resultType: 'complete', ttlMs: 0, cacheScope: 'private' };
const result = (data: Record<string, unknown>): Result => ({ ...base, ...data });

it('refuses an entry from another server or another carrier before dispatch', async () => {
  let reads = 0;
  const request = async (method: string) => {
    if (method === 'resources/read') reads++;
    return result({ skill: entry });
  };
  const first = createSkillsSession(identity, request);
  const otherServer = createSkillsSession({ ...identity, serverId: 'b' }, request);
  const otherCarrier = createSkillsSession(
    { ...identity, catalogGeneration: 'generation-b' },
    request,
  );
  const original = await first.get(uri);
  await otherServer.get(uri);
  await otherCarrier.get(uri);
  await expect(otherServer.read(original, uri)).rejects.toMatchObject({
    reason: 'changed-manifest',
  });
  await expect(otherCarrier.read(original, uri)).rejects.toMatchObject({
    reason: 'changed-manifest',
  });
  expect(reads).toBe(0);
});

it('does not publish a partial listing that exceeds the host page bound', async () => {
  const skills = createSkillsSession(identity, async () =>
    result({ skills: [entry], nextCursor: 'more' }),
  );
  await expect(skills.list({ maxPages: 1 })).rejects.toMatchObject({ reason: 'page-bound' });
  const claimed = { ...entry, identity, manifestFingerprint: 'unobserved' };
  await expect(skills.read(claimed, uri)).rejects.toMatchObject({ reason: 'changed-manifest' });
});

it('does not let an older concurrent refresh replace a newer manifest', async () => {
  let resolveOld!: (value: Result) => void;
  let calls = 0;
  const skills = createSkillsSession(identity, async () =>
    ++calls === 1
      ? new Promise<Result>((resolve) => {
          resolveOld = resolve;
        })
      : result({
          skill: {
            ...entry,
            frontmatter: { ...entry.frontmatter, description: 'New description' },
          },
        }),
  );
  const old = skills.get(uri);
  const newer = await skills.get(uri);
  resolveOld(result({ skill: entry }));
  await expect(old).rejects.toMatchObject({ reason: 'changed-manifest' });
  expect(newer.frontmatter.description).toBe('New description');
});

it('refuses an in-flight read if its manifest changes before the bytes arrive', async () => {
  let resolveRead!: (value: Result) => void;
  let changed = false;
  const skills = createSkillsSession(identity, async (method) =>
    method === 'resources/read'
      ? new Promise<Result>((resolve) => {
          resolveRead = resolve;
        })
      : result({
          skill: {
            ...entry,
            frontmatter: { ...entry.frontmatter, description: changed ? 'Changed' : 'Use demo' },
          },
        }),
  );
  const original = await skills.get(uri);
  const read = skills.read(original, uri);
  changed = true;
  await skills.get(uri);
  resolveRead(result({ contents: [{ uri, text: content }] }));
  await expect(read).rejects.toMatchObject({ reason: 'changed-manifest' });
});

it('preserves the base protocol absent-resultType compatibility for verified reads', async () => {
  const skills = createSkillsSession(identity, async (method) => ({
    ttlMs: 0,
    cacheScope: 'private',
    ...(method === 'resources/read' ? { contents: [{ uri, text: content }] } : { skill: entry }),
  }));
  expect((await skills.read(await skills.get(uri), uri)).text).toBe(content);
});

it('does not let an earlier listing overwrite a newer explicit refresh', async () => {
  let resolveList!: (value: Result) => void;
  const skills = createSkillsSession(identity, async (method) =>
    method === 'skills/list'
      ? new Promise<Result>((resolve) => {
          resolveList = resolve;
        })
      : result({
          skill: { ...entry, frontmatter: { ...entry.frontmatter, description: 'Newer' } },
        }),
  );
  const listing = skills.list({ maxPages: 1 });
  const newer = await skills.get(uri);
  resolveList(result({ skills: [entry] }));
  const entries = await listing;
  await expect(skills.read(entries[0]!, uri)).rejects.toMatchObject({ reason: 'changed-manifest' });
  expect(newer.frontmatter.description).toBe('Newer');
});

it('requires a fresh manifest after a malformed file response', async () => {
  let reads = 0;
  const skills = createSkillsSession(identity, async (method) => {
    if (method === 'resources/read') {
      reads++;
      return result({ contents: [] });
    }
    return result({ skill: entry });
  });
  const skill = await skills.get(uri);
  await expect(skills.read(skill, uri)).rejects.toMatchObject({ reason: 'invalid-resource' });
  await expect(skills.read(skill, uri)).rejects.toMatchObject({ reason: 'changed-manifest' });
  expect(reads).toBe(1);
});
