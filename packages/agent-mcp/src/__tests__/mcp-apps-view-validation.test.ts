import { describe, expect, it } from 'vitest';

import {
  MCP_APP_MIME_TYPE,
  MCP_APP_VIEW_MAX_BYTES,
  hasAppsCapability,
  validateAppViewResource,
} from '../catalog/app-view.js';
import { parseMCPToolUiMetadata } from '../catalog/ui-metadata.js';

import type { IUniversalObjectValue } from '@robota-sdk/agent-core';

const URI = 'ui://dash/view';
const HTML = '<!doctype html><html><body>한글 view €</body></html>';

/** Overrides may carry `undefined` or a wrong type on purpose: a server's content is foreign data. */
function document(overrides: Record<string, unknown> = {}): IUniversalObjectValue {
  return { uri: URI, mimeType: MCP_APP_MIME_TYPE, text: HTML, ...overrides } as IUniversalObjectValue;
}

describe('parseMCPToolUiMetadata', () => {
  it('accepts a ui:// reference and defaults the audience to model and app', () => {
    expect(parseMCPToolUiMetadata({ ui: { resourceUri: URI } })).toEqual({
      kind: 'accepted',
      resourceUri: URI,
      visibility: ['model', 'app'],
    });
  });

  it('keeps an explicit audience in the order the server declared it', () => {
    expect(parseMCPToolUiMetadata({ ui: { resourceUri: URI, visibility: ['app'] } })).toEqual({
      kind: 'accepted',
      resourceUri: URI,
      visibility: ['app'],
    });
    expect(
      parseMCPToolUiMetadata({ ui: { resourceUri: URI, visibility: ['app', 'model'] } }),
    ).toMatchObject({ visibility: ['app', 'model'] });
  });

  it.each([undefined, null, {}, [], 'ui', { other: { resourceUri: URI } }])(
    'finds nothing to read in %j',
    (meta) => {
      expect(parseMCPToolUiMetadata(meta)).toEqual({ kind: 'absent' });
    },
  );

  it('does not read the deprecated flat key', () => {
    expect(parseMCPToolUiMetadata({ 'ui/resourceUri': URI })).toEqual({ kind: 'absent' });
    expect(parseMCPToolUiMetadata({ 'ui/resourceUri': 'https://bad.example/' })).toEqual({
      kind: 'absent',
    });
  });

  it.each([
    ['another scheme', 'https://example.com/view'],
    ['a scheme-less path', 'dash/view'],
    ['an empty remainder', 'ui://'],
    ['an empty string', ''],
    ['embedded whitespace', 'ui://dash/my view'],
    ['a trailing newline', 'ui://dash/view\n'],
    ['an upper-case scheme', 'UI://dash/view'],
  ])('refuses %s as an invalid uri', (_label, resourceUri) => {
    expect(parseMCPToolUiMetadata({ ui: { resourceUri } })).toEqual({
      kind: 'invalid',
      reason: 'invalid-uri',
    });
  });

  it.each([
    ['a number', 5],
    ['null', null],
    ['an array', [URI]],
    ['an object', { href: URI }],
  ])('refuses %s as the reference', (_label, resourceUri) => {
    expect(parseMCPToolUiMetadata({ ui: { resourceUri } })).toEqual({
      kind: 'invalid',
      reason: 'invalid-type',
    });
  });

  it.each([['a string', 'ui://dash/view'], ['null', null], ['an array', [URI]], ['a number', 1]])(
    'refuses %s as the ui declaration',
    (_label, ui) => {
      expect(parseMCPToolUiMetadata({ ui })).toEqual({ kind: 'invalid', reason: 'invalid-type' });
    },
  );

  it.each([
    ['an empty list', []],
    ['a string', 'app'],
    ['an unknown audience', ['admin']],
    ['a mixed list', ['app', 7]],
    ['a repeated audience', ['app', 'app']],
    ['null', null],
  ])('refuses %s as the audience', (_label, visibility) => {
    expect(parseMCPToolUiMetadata({ ui: { resourceUri: URI, visibility } })).toEqual({
      kind: 'invalid',
      reason: 'invalid-visibility',
    });
  });

  it('keeps a declaration that only withholds the tool from the model, and nothing else', () => {
    expect(parseMCPToolUiMetadata({ ui: { visibility: ['app'] } })).toEqual({
      kind: 'accepted',
      visibility: ['app'],
    });
    expect(parseMCPToolUiMetadata({ ui: { visibility: ['model'] } })).toEqual({ kind: 'absent' });
    expect(parseMCPToolUiMetadata({ ui: {} })).toEqual({ kind: 'absent' });
    expect(parseMCPToolUiMetadata({ ui: { visibility: [] } })).toEqual({
      kind: 'invalid',
      reason: 'invalid-visibility',
    });
  });

  it('never carries the raw metadata or any other field into the projection', () => {
    const accepted = parseMCPToolUiMetadata({
      ui: { resourceUri: URI, csp: { connectDomains: ['https://x'] }, secret: 's' },
      other: 'value',
    });
    expect(Object.keys(accepted).sort()).toEqual(['kind', 'resourceUri', 'visibility']);
  });
});

describe('hasAppsCapability', () => {
  it('is true only for an object under the extension key', () => {
    expect(hasAppsCapability({ 'io.modelcontextprotocol/ui': {} })).toBe(true);
    expect(hasAppsCapability({ 'io.modelcontextprotocol/ui': { mimeTypes: [MCP_APP_MIME_TYPE] } })).toBe(
      true,
    );
  });

  it.each([
    undefined,
    null,
    'io.modelcontextprotocol/ui',
    [],
    {},
    { 'io.modelcontextprotocol/skills': {} },
    { 'io.modelcontextprotocol/ui': null },
    { 'io.modelcontextprotocol/ui': true },
    { 'io.modelcontextprotocol/ui': [] },
    { 'io.modelcontextprotocol/ui': 'yes' },
  ])('is false for %j', (extensions) => {
    expect(hasAppsCapability(extensions)).toBe(false);
  });
});

describe('validateAppViewResource', () => {
  it('accepts the one requested document and names the media type it is hosted as', () => {
    expect(validateAppViewResource(URI, { contents: [document()] })).toEqual({
      ok: true,
      html: HTML,
      mimeType: MCP_APP_MIME_TYPE,
    });
  });

  it('accepts the media type however it is cased or spaced', () => {
    for (const mimeType of ['Text/HTML;profile=mcp-app', 'text/html; profile=mcp-app', ' TEXT/html ;PROFILE=MCP-app ']) {
      expect(validateAppViewResource(URI, { contents: [document({ mimeType })] })).toMatchObject({
        ok: true,
        mimeType: MCP_APP_MIME_TYPE,
      });
    }
  });

  it('decodes a blob as UTF-8', () => {
    const blob = Buffer.from(HTML, 'utf8').toString('base64');
    expect(
      validateAppViewResource(URI, { contents: [document({ text: undefined, blob })] }),
    ).toEqual({ ok: true, html: HTML, mimeType: MCP_APP_MIME_TYPE });
  });

  it('refuses an empty result as missing', () => {
    expect(validateAppViewResource(URI, { contents: [] })).toEqual({
      ok: false,
      reason: 'missing',
    });
  });

  it('refuses a different media type, including plain html', () => {
    for (const mimeType of ['text/html', 'text/html;profile=other', 'application/json', undefined, 7]) {
      expect(validateAppViewResource(URI, { contents: [document({ mimeType })] })).toEqual({
        ok: false,
        reason: 'mime-type',
      });
    }
  });

  it('refuses a document the server answered for another uri', () => {
    expect(
      validateAppViewResource(URI, { contents: [document({ uri: 'ui://dash/other' })] }),
    ).toEqual({ ok: false, reason: 'uri-mismatch' });
  });

  it('refuses more than one content item, even when the first is the right one', () => {
    expect(validateAppViewResource(URI, { contents: [document(), document()] })).toEqual({
      ok: false,
      reason: 'content',
    });
  });

  it.each([
    ['neither text nor blob', { text: undefined }],
    ['both text and blob', { blob: Buffer.from(HTML).toString('base64') }],
    ['empty text', { text: '' }],
    ['a non-string text', { text: 5 }],
    ['a blob that is not base64', { text: undefined, blob: 'not base64!!' }],
    ['a blob with a bad length', { text: undefined, blob: 'abc' }],
    ['an empty blob', { text: undefined, blob: '' }],
    ['a blob that is not UTF-8', { text: undefined, blob: Buffer.from([0xff, 0xfe, 0xfd]).toString('base64') }],
  ])('refuses %s as invalid content', (_label, overrides) => {
    expect(validateAppViewResource(URI, { contents: [document(overrides)] })).toEqual({
      ok: false,
      reason: 'content',
    });
  });

  it('bounds the text by its UTF-8 bytes, not its characters', () => {
    const atLimit = 'a'.repeat(MCP_APP_VIEW_MAX_BYTES);
    expect(validateAppViewResource(URI, { contents: [document({ text: atLimit })] })).toMatchObject({
      ok: true,
    });
    expect(
      validateAppViewResource(URI, { contents: [document({ text: `${atLimit}a` })] }),
    ).toEqual({ ok: false, reason: 'too-large' });
    // Fewer characters than the limit, more bytes than it.
    const wide = '€'.repeat(Math.floor(MCP_APP_VIEW_MAX_BYTES / 3) + 1);
    expect(wide.length).toBeLessThan(MCP_APP_VIEW_MAX_BYTES);
    expect(validateAppViewResource(URI, { contents: [document({ text: wide })] })).toEqual({
      ok: false,
      reason: 'too-large',
    });
  });

  it('bounds a blob by its decoded size and refuses before decoding it', () => {
    const atLimit = Buffer.alloc(MCP_APP_VIEW_MAX_BYTES, 0x61).toString('base64');
    expect(
      validateAppViewResource(URI, { contents: [document({ text: undefined, blob: atLimit })] }),
    ).toMatchObject({ ok: true });
    const over = Buffer.alloc(MCP_APP_VIEW_MAX_BYTES + 1, 0x61).toString('base64');
    expect(
      validateAppViewResource(URI, { contents: [document({ text: undefined, blob: over })] }),
    ).toEqual({ ok: false, reason: 'too-large' });
  });

  it('keeps the size bound below the default receive budget and the surface frame limit', () => {
    expect(MCP_APP_VIEW_MAX_BYTES).toBe(2 * 1024 * 1024);
  });
});
