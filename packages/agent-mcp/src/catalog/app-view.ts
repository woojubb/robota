/**
 * MCP Apps: the negotiated extension, the bounded read of a tool's declared view and the names a
 * view may call back. A view is display data for a surface that hosts it in an isolated frame; none
 * of it enters model context.
 */

import type { IMCPCatalog } from './types.js';
import type { IUniversalObjectValue } from '@robota-sdk/agent-core';

export const MCP_APPS_EXTENSION = 'io.modelcontextprotocol/ui';
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';
/**
 * Below the default receive budget, so a document that fits can arrive, and small enough to cross a
 * surface's socket once JSON-encoded, which the surface's own frame limit refuses beyond 4 MiB.
 */
export const MCP_APP_VIEW_MAX_BYTES = 2 * 1024 * 1024;

/** True when a server's declared `extensions` carries the UI extension as an object. */
export function hasAppsCapability(extensions: unknown): boolean {
  if (typeof extensions !== 'object' || extensions === null || Array.isArray(extensions))
    return false;
  const value = (extensions as Record<string, unknown>)[MCP_APPS_EXTENSION];
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type TMCPAppViewProblem = 'missing' | 'uri-mismatch' | 'mime-type' | 'content' | 'too-large';

export type TMCPAppViewResource =
  | { readonly ok: true; readonly html: string; readonly mimeType: string }
  | { readonly ok: false; readonly reason: TMCPAppViewProblem };

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;

function normalizedMimeType(value: unknown): string | undefined {
  return typeof value === 'string' ? value.replace(/\s+/gu, '').toLowerCase() : undefined;
}

/** The decoded size of a well-formed base64 string, without decoding it. */
function base64DecodedBytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

function decodeUtf8(data: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    // allow-fallback: a document that is not UTF-8 is reported as invalid content, not thrown.
    return undefined;
  }
}

function documentOf(item: IUniversalObjectValue): TMCPAppViewResource {
  const text = item['text'];
  const blob = item['blob'];
  if (typeof text === 'string' && blob === undefined) {
    if (text.length === 0) return { ok: false, reason: 'content' };
    if (Buffer.byteLength(text, 'utf8') > MCP_APP_VIEW_MAX_BYTES) {
      return { ok: false, reason: 'too-large' };
    }
    return { ok: true, html: text, mimeType: MCP_APP_MIME_TYPE };
  }
  if (typeof blob === 'string' && text === undefined) {
    if (blob.length === 0 || blob.length % 4 !== 0 || !BASE64.test(blob)) {
      return { ok: false, reason: 'content' };
    }
    if (base64DecodedBytes(blob) > MCP_APP_VIEW_MAX_BYTES) return { ok: false, reason: 'too-large' };
    const html = decodeUtf8(Buffer.from(blob, 'base64'));
    return html === undefined || html.length === 0
      ? { ok: false, reason: 'content' }
      : { ok: true, html, mimeType: MCP_APP_MIME_TYPE };
  }
  return { ok: false, reason: 'content' };
}

/**
 * Accepts a `resources/read` result as a tool's view only when it is the one document asked for, of
 * the one media type this host hosts, and within the size bound. Otherwise a fixed reason, never
 * anything the server said.
 */
export function validateAppViewResource(
  uri: string,
  result: { readonly contents: readonly IUniversalObjectValue[] },
): TMCPAppViewResource {
  if (result.contents.length === 0) return { ok: false, reason: 'missing' };
  const [item] = result.contents;
  if (result.contents.length !== 1 || item === undefined) return { ok: false, reason: 'content' };
  if (item['uri'] !== uri) return { ok: false, reason: 'uri-mismatch' };
  if (normalizedMimeType(item['mimeType']) !== MCP_APP_MIME_TYPE) {
    return { ok: false, reason: 'mime-type' };
  }
  return documentOf(item);
}

/**
 * Source tool name → runtime name for the tools of one server that a view may call: every offered
 * tool whose declared visibility includes `app`, and every one that declared none (the default
 * includes it).
 */
export function appCallableToolNames(
  catalog: IMCPCatalog,
  serverId: string,
): Readonly<Record<string, string>> {
  const names: (readonly [string, string])[] = [];
  for (const entry of [...catalog.adopted, ...catalog.adapted]) {
    if (entry.kind !== 'tool' || entry.provenance.serverId !== serverId) continue;
    if (entry.ui !== undefined && !entry.ui.visibility.includes('app')) continue;
    names.push([entry.sourceName, entry.canonicalName]);
  }
  // `fromEntries` defines own properties, so a server's tool named like an object member is safe.
  return Object.fromEntries(names);
}
