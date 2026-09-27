import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import path from 'node:path';
import { BLOCKED_HOSTNAMES, isPrivateAddress } from '@robota-sdk/agent-core/node';
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
 * The guard therefore allows only `http:`/`https:`, refuses loopback and cloud-metadata hostnames,
 * and refuses any address that is not public unicast — a literal one before the request, a resolved
 * one at connect time — re-validates every redirect hop, and bounds the exchange with a deadline.
 * Addresses are classified by agent-core's egress classifier, so this store and the shared egress
 * boundary cannot disagree about what is private.
 *
 * Resolution happens inside the socket's own `lookup`, and the socket connects to exactly the
 * address that lookup approved: the address judged is the address reached, so DNS rebinding has no
 * second resolution to change.
 */
const ALLOWED_SOURCE_URI_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

/** Wall-clock budget for dereferencing one reference asset (no timeout = an indefinite socket hold). */
const SOURCE_URI_FETCH_TIMEOUT_MS = 30_000;

/** Redirect hops followed before giving up; every hop is re-validated by the same guard. */
const MAX_SOURCE_URI_REDIRECTS = 3;

const REDIRECT_STATUS_CODES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;

/** True when the URL host must never be dereferenced from this process, before any resolution. */
function isBlockedHost(hostname: string): boolean {
  // `URL.hostname` brackets IPv6 literals; strip them before matching.
  const host = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
    return true;
  }
  return isIP(host) !== 0 && isPrivateAddress(host);
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
 * The socket's resolver: every answer is classified, and one private answer refuses the host — the
 * connection may try any of them.
 */
const pinnedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err, '');
      return;
    }
    const blocked = addresses.find((entry) => isPrivateAddress(entry.address));
    const first = addresses[0];
    if (blocked !== undefined || first === undefined) {
      callback(
        new Error(
          `asset sourceUri host is not allowed (loopback/private/link-local address): ${hostname} ` +
            `resolves to ${blocked?.address ?? 'no address'}`,
        ),
        '',
      );
      return;
    }
    if (options.all === true) callback(null, addresses);
    else callback(null, first.address, first.family);
  });
};

/**
 * One request on a fresh socket (`agent: false`): a pooled keep-alive socket or an environment proxy
 * would reach the host without running {@link pinnedLookup}.
 */
function requestSourceUri(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = send(
      url,
      { agent: false, lookup: pinnedLookup, signal, headers: { 'user-agent': 'node' } },
      resolve,
    );
    request.on('error', reject);
    request.end();
  });
}

/**
 * Fetch a validated reference URI, re-validating each redirect hop. Redirects are followed
 * manually so a public host cannot bounce the request onto a private address that the initial
 * check already cleared. The deadline covers every hop and the body.
 */
async function fetchSourceUri(initialUrl: URL): Promise<IncomingMessage> {
  const signal = AbortSignal.timeout(SOURCE_URI_FETCH_TIMEOUT_MS);
  let target = initialUrl;
  for (let hop = 0; hop <= MAX_SOURCE_URI_REDIRECTS; hop += 1) {
    const response = await requestSourceUri(target, signal);
    if (!REDIRECT_STATUS_CODES.has(response.statusCode ?? 0)) {
      return response;
    }
    response.destroy();
    const location = response.headers.location;
    if (location === undefined || location.length === 0) {
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
      const status = response.statusCode ?? 0;
      if (status < HTTP_OK_MIN || status > HTTP_OK_MAX) {
        response.destroy();
        return undefined;
      }
      return { stream: response, metadata };
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
