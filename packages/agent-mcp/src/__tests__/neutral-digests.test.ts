import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { validateAppViewResource } from '../catalog/app-view.js';
import { canonicalName } from '../catalog/naming.js';
import { base64ToBytes, utf8ToBase64 } from '../bytes.js';
import { definitionFingerprint, securityIdentity } from '../definition/identity.js';
import { parseSkillEntry, verifySkillResource } from '../skills/manifest.js';
import text from './__fixtures__/non-ascii-text.json';

import type { IMCPResolvedEntry, IMCPServerDefinitionResolved } from '../definition/types.js';

/**
 * These values were written by the `node:crypto` and `Buffer` implementations that preceded the
 * platform-neutral ones. An approval, a catalog name and a skill manifest are kept or compared across
 * runs, so the same input must keep producing the same bytes; each literal below is what `node:crypto`
 * produced for it, not something recomputed by the code under test.
 */
const definition = (overrides: Partial<IMCPServerDefinitionResolved> = {}) =>
  ({
    name: 'alpha',
    source: 'project',
    origin: '.mcp.json',
    transport: 'stdio',
    command: 'server',
    args: ['--port', '1'],
    env: { API_KEY: 'sk-1' },
    unsetVariables: [],
    ...overrides,
  }) as IMCPServerDefinitionResolved;

const entry = (overrides: Partial<IMCPResolvedEntry> = {}) =>
  ({
    name: 'alpha',
    source: 'project',
    origin: '.mcp.json',
    status: 'resolved',
    definition: definition(),
    shadowed: [],
    ...overrides,
  }) as IMCPResolvedEntry;

/** The digest as `node:crypto` computed it: one update per length, separator and part. */
function nodeDigest(parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(String(part.length));
    hash.update(':');
    hash.update(part);
  }
  return hash.digest('hex').slice(0, 32);
}

describe('activation identity digests', () => {
  it('keeps the definition fingerprint an earlier approval was bound to', () => {
    expect(definitionFingerprint(definition())).toBe('4ca261c5a0f74a12885b009569ce326c');
    expect(
      definitionFingerprint(
        definition({
          transport: 'http',
          command: undefined,
          args: undefined,
          env: undefined,
          url: 'https://example.com/mcp',
          headers: { 'X-Team': 'platform' },
          timeout: 5000,
          protocolVersion: '2026-07-28',
          skills: true,
        }),
      ),
    ).toBe('d05a312a8c180b7d922239569ee90ca7');
    expect(
      definitionFingerprint(
        definition({
          transport: 'http',
          command: undefined,
          args: undefined,
          env: undefined,
          url: 'https://example.com/mcp',
          oauth: {
            clientId: 'cid',
            callbackPort: 8123,
            authServerMetadataUrl: 'https://auth.example.com/.well-known/x',
            scopes: ['a', 'b'],
          },
        }),
      ),
    ).toBe('bcf4ece364c3ac6d7ff8a0f133e491fb');
  });

  it('keeps it for text outside ASCII, including a lone surrogate', () => {
    expect(
      definitionFingerprint(definition({ args: ['--name', text.hangulWithGlobe, 'a\uD800b'] })),
    ).toBe('5ae4945e520edf5adbe0843107c4d98e');
  });

  it('keeps the security identity of a configured subject', () => {
    expect(securityIdentity(entry())).toBe('1c9fc6a917b8209b97a8a34b549dc68c');
    expect(
      securityIdentity(
        entry({ name: text.hangulName, source: 'user', origin: text.hangulHomePath }),
      ),
    ).toBe('6af1a9a5b56547b223eafedb8ab8d508');
  });

  it.each([
    { name: 'plain', origin: '.mcp.json' },
    { name: text.hangulServerName, origin: text.hangulHomePath },
    { name: 'a\uD800', origin: '\uDC00b' },
    { name: 'x'.repeat(200), origin: 'y'.repeat(55) },
    { name: '', origin: '' },
  ])('hashes the parts one by one as UTF-8, as node:crypto did, for $name', ({ name, origin }) => {
    expect(securityIdentity(entry({ name, origin }))).toBe(
      nodeDigest(['name', name, 'source', 'project', 'origin', origin]),
    );
  });
});

describe('canonical names', () => {
  const longServer = `server-${'x'.repeat(40)}`;
  const longTool = `tool-${'y'.repeat(40)}`;

  it('keeps the hash a truncated name carries', () => {
    expect(canonicalName(longServer, longTool)).toEqual({
      name: 'server-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx__-2bc5e9b8-yyyyy',
      changed: true,
      reason: 'truncated',
    });
    expect(canonicalName(`${longServer}.io/east`, `${longTool} (v2)`)).toEqual({
      name: 'server-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx_io_eas-8be1b701-',
      changed: true,
      reason: 'renamed, truncated',
    });
    expect(canonicalName(longServer, longTool, 12).name).toBe('se-2bc5e9b8-');
  });
});

describe('skill manifests', () => {
  const identity = {
    serverId: 'srv',
    serverName: 'srv',
    serverVersion: '1',
    protocolVersion: '2025-03-26',
  } as never;
  const uri = 'skill://acme/demo/SKILL.md';
  const frontmatter = { name: 'demo', description: 'Demo skill' };

  it('keeps the manifest fingerprint a stored approval compares against', () => {
    const listed = parseSkillEntry(
      {
        uri,
        frontmatter,
        resources: [
          { uri, digest: `sha256:${'a'.repeat(64)}`, size: 3 },
          { uri: 'skill://acme/demo/docs/guide.md', digest: `sha256:${'b'.repeat(64)}`, size: 5 },
        ],
      },
      identity,
    );
    expect(listed.manifestFingerprint).toBe(
      '5e121452d6ff74412b4edbda8b303e79a1e980fd25f011e714c8870092b0f427',
    );
    const dynamic = parseSkillEntry(
      {
        uri,
        frontmatter: { ...frontmatter, extra: { z: 1, a: [true, null, text.hangulSyllable] } },
        resources: 'dynamic',
      },
      identity,
    );
    expect(dynamic.manifestFingerprint).toBe(
      '47125d01e8fd7d5064a47c0f69958048687ec85b482060e16abac117c1f256ea',
    );
  });

  it('verifies a text resource by the SHA-256 of its UTF-8 bytes', () => {
    const resource = text.accentedHangulGlobe;
    const skill = parseSkillEntry(
      {
        uri,
        frontmatter,
        resources: [
          {
            uri,
            digest: 'sha256:f52cb78ae1df951502c23822633441a862948d76d3aaaf5165cb150d549e99ed',
            size: 21,
          },
        ],
      },
      identity,
    );
    expect(verifySkillResource(skill, uri, { uri, text: resource })).toMatchObject({
      size: 21,
      text: resource,
    });
  });

  it('verifies a binary resource across every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_value, index) => index);
    const blob = Buffer.from(bytes).toString('base64');
    const skill = parseSkillEntry(
      {
        uri,
        frontmatter,
        resources: [
          {
            uri,
            digest: 'sha256:40aff2e9d2d8922e47afd4648e6967497158785fbd1da870e7110266bf944880',
            size: 256,
          },
        ],
      },
      identity,
    );
    expect(verifySkillResource(skill, uri, { uri, blob })).toMatchObject({ size: 256, blob });
  });
});

describe('base64 without Buffer', () => {
  it.each(['', 'a', 'ab', 'abc', 'id:secret', 'üser:pässwörd', text.hangulGlobePair, 'x'.repeat(1000)])(
    'encodes the UTF-8 bytes of %j as Buffer does',
    (sample) => {
      expect(utf8ToBase64(sample)).toBe(Buffer.from(sample, 'utf8').toString('base64'));
    },
  );

  it.each([0, 1, 2, 3, 4, 5, 255, 256, 1000])('decodes %i bytes as Buffer does', (length) => {
    const bytes = Uint8Array.from({ length }, (_value, index) => (index * 37 + 11) % 256);
    expect([...base64ToBytes(Buffer.from(bytes).toString('base64'))]).toEqual([...bytes]);
  });

  it('accepts omitted padding and ASCII whitespace, as atob does', () => {
    expect([...base64ToBytes('YQ')]).toEqual([0x61]);
    expect([...base64ToBytes('YW Jj\n')]).toEqual([0x61, 0x62, 0x63]);
  });

  it('refuses what is not base64', () => {
    expect(() => base64ToBytes('not base64!')).toThrow();
  });

  it('decodes an app view blob and measures a text view in UTF-8 bytes', () => {
    const html = text.accentedHangulHtml;
    const uri = 'ui://widget';
    const mimeType = 'text/html;profile=mcp-app';
    expect(
      validateAppViewResource(uri, {
        contents: [{ uri, mimeType, blob: Buffer.from(html, 'utf8').toString('base64') }],
      }),
    ).toEqual({ ok: true, html, mimeType });
    const oversize = 'é'.repeat(1024 * 1024 + 1);
    expect(validateAppViewResource(uri, { contents: [{ uri, mimeType, text: oversize }] })).toEqual({
      ok: false,
      reason: 'too-large',
    });
    expect(
      validateAppViewResource(uri, { contents: [{ uri, mimeType, text: 'é'.repeat(1024 * 1024) }] }),
    ).toMatchObject({ ok: true });
  });
});
