import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import type {
  IAssetStore,
  IStoredAssetMetadata,
  ICreateAssetInput,
  ICreateAssetReferenceInput,
  IAssetContentResult,
} from '@robota-sdk/dag-core';

export type { IStoredAssetMetadata } from '@robota-sdk/dag-core';

/**
 * SSRF guard for reference assets.
 *
 * `sourceUri` is NOT operator configuration: it is whatever URI an upstream DAG node produced
 * (`asset-aware-executor` persists `value.uri` onto the metadata sidecar), so a task executor —
 * including one driven by model output — chooses it. Dereferencing it unguarded turns this store
 * into a server-side request forgery gadget: cloud-metadata credentials (`169.254.169.254`),
 * loopback admin ports, and (on runtimes that support them) `file:`/`data:` local reads.
 *
 * The guard therefore allows only `http:`/`https:`, rejects hosts that are literal loopback,
 * private (RFC1918), CGNAT, link-local, or IPv6 unique-local/link-local addresses, re-validates
 * every redirect hop, and bounds the request with a timeout.
 *
 * RESIDUAL GAP (stated rather than overclaimed): the host check is LITERAL-IP + hostname only.
 * A DNS NAME that resolves to a private address is not blocked, and neither is DNS rebinding
 * (resolution changing between this check and the socket connect). Closing that requires
 * connect-time address pinning via a custom undici dispatcher, which is out of scope here.
 */
const ALLOWED_SOURCE_URI_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

/** Hostnames that always denote the local machine regardless of resolver configuration. */
const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set(['localhost']);

/** Wall-clock budget for dereferencing one reference asset (no timeout = an indefinite socket hold). */
const SOURCE_URI_FETCH_TIMEOUT_MS = 30_000;

/** Redirect hops followed before giving up; every hop is re-validated by the same guard. */
const MAX_SOURCE_URI_REDIRECTS = 3;

const REDIRECT_STATUS_CODES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** Parse a dotted-quad IPv4 literal. Returns `undefined` when `host` is not one. */
function parseIpv4Octets(host: string): readonly number[] | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) {
    return undefined;
  }
  const octets = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : undefined;
}

/** Blocked /8 blocks, keyed by first octet: unspecified, RFC1918 private, loopback. */
const BLOCKED_IPV4_SLASH8: ReadonlySet<number> = new Set([0, 10, 127]);

/** Blocked blocks narrower than /8, as `first octet → inclusive second-octet range`. */
const BLOCKED_IPV4_SECOND_OCTET_RANGES: ReadonlyMap<number, readonly [number, number]> = new Map([
  [100, [64, 127]], // 100.64.0.0/10 — RFC6598 CGNAT
  [169, [254, 254]], // 169.254.0.0/16 — link-local, incl. the 169.254.169.254 cloud-metadata service
  [172, [16, 31]], // 172.16.0.0/12 — RFC1918 private
  [192, [168, 168]], // 192.168.0.0/16 — RFC1918 private
]);

/** True when the IPv4 literal is loopback, unspecified, private, CGNAT, or link-local. */
function isBlockedIpv4(octets: readonly number[]): boolean {
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  if (BLOCKED_IPV4_SLASH8.has(first)) {
    return true;
  }
  const range = BLOCKED_IPV4_SECOND_OCTET_RANGES.get(first);
  return range !== undefined && second >= range[0] && second <= range[1];
}

/**
 * Extract the embedded IPv4 address of an IPv4-mapped/compatible IPv6 literal. Both the dotted form
 * (`::ffff:127.0.0.1`) and the hex form the WHATWG URL parser normalizes it to (`::ffff:7f00:1`)
 * must be recognized, or `http://[::ffff:127.0.0.1]/` would slip past the loopback check.
 */
function parseIpv4MappedOctets(host: string): readonly number[] | undefined {
  const dotted = /^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
  if (dotted?.[1] !== undefined) {
    return parseIpv4Octets(dotted[1]);
  }
  const hex = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (hex?.[1] === undefined || hex[2] === undefined) {
    return undefined;
  }
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  // eslint-disable-next-line no-bitwise
  return [high >>> 8, high & 0xff, low >>> 8, low & 0xff];
}

/** True when the IPv6 literal is loopback, unspecified, unique-local (fc00::/7), or link-local. */
function isBlockedIpv6(host: string): boolean {
  if (host === '::1' || host === '::') return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return true; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]?:/.test(host)) return true; // fe80::/10 link-local
  const mapped = parseIpv4MappedOctets(host);
  return mapped !== undefined && isBlockedIpv4(mapped);
}

/** True when the URL host must never be dereferenced from this process. */
function isBlockedHost(hostname: string): boolean {
  // `URL.hostname` brackets IPv6 literals; strip them before matching.
  const host = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
    return true;
  }
  const octets = parseIpv4Octets(host);
  if (octets !== undefined) {
    return isBlockedIpv4(octets);
  }
  return host.includes(':') && isBlockedIpv6(host);
}

/**
 * Validate a reference URI against the SSRF guard, returning the URL to fetch.
 * Rejection **throws** with the reason — the caller must not turn a blocked URI into a silent
 * `undefined`, which is indistinguishable from "asset not found".
 */
function assertFetchableSourceUri(sourceUri: string, base?: URL): URL {
  let url: URL;
  try {
    url = new URL(sourceUri, base);
  } catch (cause) {
    throw new Error(`asset sourceUri is not a valid URL: ${sourceUri}`, { cause });
  }
  if (!ALLOWED_SOURCE_URI_PROTOCOLS.has(url.protocol)) {
    throw new Error(
      `asset sourceUri scheme is not allowed (only http/https): ${url.protocol}//${url.host}`,
    );
  }
  if (isBlockedHost(url.hostname)) {
    throw new Error(
      `asset sourceUri host is not allowed (loopback/private/link-local address): ${url.host}`,
    );
  }
  return url;
}

/**
 * Fetch a validated reference URI, re-validating each redirect hop. Redirects are followed
 * manually because `fetch`'s automatic following would let a public host bounce the request onto
 * a private address that the initial check already cleared.
 */
async function fetchSourceUri(initialUrl: URL): Promise<Response> {
  let target = initialUrl;
  for (let hop = 0; hop <= MAX_SOURCE_URI_REDIRECTS; hop += 1) {
    const response = await fetch(target, {
      redirect: 'manual',
      signal: AbortSignal.timeout(SOURCE_URI_FETCH_TIMEOUT_MS),
    });
    if (!REDIRECT_STATUS_CODES.has(response.status)) {
      return response;
    }
    const location = response.headers.get('location');
    if (location === null || location.length === 0) {
      throw new Error(`asset sourceUri redirect is missing a Location header: ${target.href}`);
    }
    target = assertFetchableSourceUri(location, target);
  }
  throw new Error(
    `asset sourceUri exceeded ${MAX_SOURCE_URI_REDIRECTS} redirects: ${initialUrl.href}`,
  );
}

export class LocalFsAssetStore implements IAssetStore {
  private readonly rootDir: string;

  public constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  public async initialize(): Promise<void> {
    if (!existsSync(this.rootDir)) {
      await mkdir(this.rootDir, { recursive: true });
    }
  }

  public async save(input: ICreateAssetInput): Promise<IStoredAssetMetadata> {
    const assetId = randomUUID();
    const filePath = this.buildBinaryPath(assetId);
    const metadataPath = this.buildMetadataPath(assetId);
    const now = new Date().toISOString();
    await writeFile(filePath, input.content);
    const metadata: IStoredAssetMetadata = {
      assetId,
      fileName: input.fileName,
      mediaType: input.mediaType,
      sizeBytes: input.content.byteLength,
      createdAt: now,
      runtimeAssetId: input.runtimeAssetId,
    };
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    return metadata;
  }

  public async saveReference(input: ICreateAssetReferenceInput): Promise<IStoredAssetMetadata> {
    const assetId = randomUUID();
    const metadataPath = this.buildMetadataPath(assetId);
    const now = new Date().toISOString();
    const metadata: IStoredAssetMetadata = {
      assetId,
      fileName: input.fileName,
      mediaType: input.mediaType,
      sizeBytes: input.sizeBytes ?? 0,
      createdAt: now,
      sourceUri: input.sourceUri,
      binaryKind: input.binaryKind,
    };
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    return metadata;
  }

  public async getMetadata(assetId: string): Promise<IStoredAssetMetadata | undefined> {
    const metadataPath = this.buildMetadataPath(assetId);
    if (!existsSync(metadataPath)) {
      return undefined;
    }
    const metadataText = await readFile(metadataPath, 'utf-8');
    return JSON.parse(metadataText) as IStoredAssetMetadata;
  }

  public async getContent(assetId: string): Promise<IAssetContentResult | undefined> {
    const metadata = await this.getMetadata(assetId);
    if (!metadata) {
      return undefined;
    }
    if (typeof metadata.sourceUri === 'string' && metadata.sourceUri.trim().length > 0) {
      // Throws (never silently returns undefined) when the URI fails the SSRF guard above.
      const response = await fetchSourceUri(assertFetchableSourceUri(metadata.sourceUri.trim()));
      if (!response.ok || !response.body) {
        return undefined;
      }
      return {
        stream: Readable.fromWeb(response.body as unknown as NodeWebReadableStream),
        metadata,
      };
    }
    const binaryPath = this.buildBinaryPath(assetId);
    if (!existsSync(binaryPath)) {
      return undefined;
    }
    const fileInfo = await stat(binaryPath);
    if (!fileInfo.isFile()) {
      return undefined;
    }
    return {
      stream: createReadStream(binaryPath),
      metadata,
    };
  }

  private buildBinaryPath(assetId: string): string {
    return path.join(this.rootDir, `${assetId}.bin`);
  }

  private buildMetadataPath(assetId: string): string {
    return path.join(this.rootDir, `${assetId}.json`);
  }
}
