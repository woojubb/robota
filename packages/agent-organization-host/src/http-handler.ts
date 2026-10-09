import type { IncomingMessage, ServerResponse } from 'node:http';
import { organizationCanonical } from './canonical.js';
import type { OrganizationBroker } from './broker.js';
import { OrganizationRefused } from './types.js';
import { integer } from './verification.js';
import type { IOrganizationCall } from './types.js';

export interface IOrganizationHttpOptions {
  readonly broker: OrganizationBroker;
  /** Must equal the ledger's audience. Public deployments terminate TLS in the operator domain. */
  readonly audience: string;
  readonly bodyTimeoutMs?: number;
}

/** One worker ingress. No minting, approval, policy, budget, refund or administration routes. */
export function createOrganizationHttpHandler(
  options: IOrganizationHttpOptions,
): (request: IncomingMessage, response: ServerResponse) => void {
  const url = new URL(options.audience);
  const local = ['127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    options.audience !== options.broker.audience ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.pathname !== '/' ||
    options.audience !== url.origin
  )
    throw new OrganizationRefused('invalid-schema');
  const timeoutMs = integer(options.bodyTimeoutMs ?? 2000, 1);
  if (timeoutMs > 30_000) throw new OrganizationRefused('invalid-schema');

  return (request, response) => {
    const controller = new AbortController();
    const disconnected = (): void => {
      if (!response.writableFinished) controller.abort();
    };
    response.once('close', disconnected);
    const reply = (status: number, value: unknown): void => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      response.end(organizationCanonical(value));
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        // Browser origins and proxy headers are not authority. Workers sign a pinned audience.
        const sensitive = ['host', 'content-type', 'content-length', 'transfer-encoding', 'origin'];
        const seen = new Set<string>();
        for (let index = 0; index < request.rawHeaders.length; index += 2) {
          const header = request.rawHeaders[index]!.toLowerCase();
          if (!sensitive.includes(header)) continue;
          if (seen.has(header)) throw new OrganizationRefused('invalid-schema');
          seen.add(header);
        }
        if (
          request.method !== 'POST' ||
          request.url !== '/v1/apply' ||
          request.headers.host !== url.host ||
          request.headers.origin !== undefined ||
          request.headers['content-type'] !== 'application/json' ||
          request.headers['content-encoding'] !== undefined
        )
          throw new OrganizationRefused('not-authorized');
        const length = request.headers['content-length'];
        if (
          length !== undefined &&
          (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > 64 * 1024)
        )
          throw new OrganizationRefused('invalid-schema');
        const chunks: Buffer[] = [];
        let size = 0;
        timer = setTimeout(() => {
          controller.abort();
          request.destroy();
        }, timeoutMs);
        for await (const chunk of request) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
          size += buffer.length;
          if (size > 64 * 1024) throw new OrganizationRefused('invalid-schema');
          chunks.push(buffer);
        }
        clearTimeout(timer);
        timer = undefined;
        const bytes = Buffer.concat(chunks);
        const wire = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        const data: unknown = JSON.parse(wire);
        // Reject duplicate keys, invalid UTF-8 and alternate encodings before signature verification.
        if (wire !== organizationCanonical(data)) throw new OrganizationRefused('invalid-schema');
        const receipt = await options.broker.apply(data as IOrganizationCall, controller.signal);
        reply(200, { receipt });
      } catch (error) {
        const reason = error instanceof OrganizationRefused ? error.reason : 'invalid-schema';
        reply(reason === 'policy-unavailable' ? 503 : 403, { refused: reason });
        request.resume();
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        response.removeListener('close', disconnected);
      }
    })();
  };
}
