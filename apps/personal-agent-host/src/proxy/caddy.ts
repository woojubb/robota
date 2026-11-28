import { readFile, unlink } from 'node:fs/promises';
import { request } from 'node:http';

import { errorMessage, HostError } from '../errors.js';
import { isNotFound, writeFileAtomic } from '../fs-util.js';
import { configHash, generateCaddyfile, type ICaddyfileSettings } from './caddyfile.js';
import type { IProxyApplied, IProxyPort, ProxySite } from './port.js';

export interface IAdminResponse {
  status: number;
  body: string;
}

/** Hands one configuration to the proxy's admin API for loading. */
export type AdminTransport = (config: string) => Promise<IAdminResponse>;

const DEFAULT_TIMEOUT_MS = 30_000;
const DETAIL_LIMIT = 300;

/** Loads a configuration through the admin API on a Unix socket; there is no TCP admin endpoint. */
export function unixSocketTransport(
  socketPath: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): AdminTransport {
  return (config) =>
    new Promise<IAdminResponse>((resolve, reject) => {
      const req = request(
        {
          socketPath,
          method: 'POST',
          path: '/load',
          headers: {
            'Content-Type': 'text/caddyfile',
            'Content-Length': Buffer.byteLength(config),
          },
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
          );
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new Error('the proxy admin socket timed out')));
      req.on('error', reject);
      req.end(config);
    });
}

export interface ICaddyProxyOptions {
  /** Where the generated configuration is kept, written atomically and owner-only. */
  configPath: string;
  settings: ICaddyfileSettings;
  transport: AdminTransport;
}

async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

/**
 * The real proxy port: writes the configuration for the listed sites and loads it. A configuration
 * the proxy does not accept is rolled back to the last good one, on disk and in the proxy.
 */
export class CaddyProxy implements IProxyPort {
  private lastGood: string | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ICaddyProxyOptions) {}

  apply(sites: readonly ProxySite[]): Promise<IProxyApplied> {
    const run = this.queue.then(() => this.applyNow(sites));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async load(config: string): Promise<void> {
    const { status, body } = await this.options.transport(config);
    if (status < 200 || status >= 300) {
      throw new Error(
        `the proxy refused the configuration (HTTP ${status}): ${body.trim().slice(0, DETAIL_LIMIT)}`,
      );
    }
  }

  private async applyNow(sites: readonly ProxySite[]): Promise<IProxyApplied> {
    // Generating first means a value that fails validation touches neither the file nor the proxy.
    const next = generateCaddyfile(sites, this.options.settings);
    const { configPath } = this.options;
    const previous = this.lastGood ?? (await readIfPresent(configPath));
    try {
      await writeFileAtomic(configPath, next);
      await this.load(next);
    } catch (error) {
      await this.rollback(previous);
      throw new HostError(
        'runtime-failed',
        `The proxy configuration was not applied and the previous one is kept: ${errorMessage(error)}`,
      );
    }
    this.lastGood = next;
    return { hash: configHash(next) };
  }

  private async rollback(previous: string | undefined): Promise<void> {
    const { configPath } = this.options;
    try {
      if (previous === undefined) {
        await unlink(configPath).catch(() => undefined);
        return;
      }
      await writeFileAtomic(configPath, previous);
      // A refused configuration leaves the proxy on the old one; one that failed midway may not.
      await this.options.transport(previous).catch(() => undefined);
    } catch {
      // The original failure is the one worth reporting.
    }
  }
}
