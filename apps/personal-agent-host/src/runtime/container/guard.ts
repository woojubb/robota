import { createHash } from 'node:crypto';

import { errorMessage } from '../../errors.js';
import type { GuardState } from '../port.js';
import type { EngineClient } from './engine-client.js';
import { buildGuard, guardTableName, renderGuard } from './guard-rules.js';
import { runHelper } from './helper.js';

export interface IGuardResult {
  state: GuardState;
  detail?: string;
}

export interface INetworkGuardOptions {
  engine: EngineClient;
  installId: string;
  /** An image with the firewall tool. It runs with the one capability the tool needs. */
  guardImage: string;
  /** Resolvers to allow DNS to; discovered from the engine host when absent. */
  resolvers?: readonly string[];
  helperTimeoutMs: number;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** IPv4 nameservers of a resolver file, without loopback ones a container cannot reach. */
export function parseResolvers(text: string): string[] {
  const found: string[] = [];
  for (const line of text.split('\n')) {
    const match = /^\s*nameserver\s+(\d{1,3}(?:\.\d{1,3}){3})\s*$/u.exec(line);
    if (match && !match[1].startsWith('127.')) found.push(match[1]);
  }
  return found;
}

/**
 * Applies the guard's table on the engine host through a short-lived helper and checks that it is
 * still there. It is verified only while the table reads back exactly as it was applied; a table
 * this process has not applied counts as unverified, so a fresh start always reapplies.
 */
export class NetworkGuard {
  private readonly table: string;
  private appliedHash: string | undefined;
  private inFlight: Promise<IGuardResult> | undefined;

  constructor(private readonly options: INetworkGuardOptions) {
    this.table = guardTableName(options.installId);
  }

  private async listing(): Promise<{ ok: boolean; text: string }> {
    const result = await runHelper(
      this.options.engine,
      this.options.installId,
      {
        image: this.options.guardImage,
        entrypoint: ['nft', 'list', 'table', 'inet', this.table],
        network: 'host',
        capAdd: ['NET_ADMIN'],
      },
      this.options.helperTimeoutMs,
    );
    return { ok: result.exitCode === 0, text: result.output };
  }

  private async resolvers(): Promise<string[]> {
    if (this.options.resolvers) return [...this.options.resolvers];
    // A container on the default bridge is given the engine host's resolvers directly, the same
    // list the embedded resolver of a user network forwards to.
    const result = await runHelper(
      this.options.engine,
      this.options.installId,
      {
        image: this.options.guardImage,
        entrypoint: ['cat', '/etc/resolv.conf'],
        network: 'bridge',
      },
      this.options.helperTimeoutMs,
    );
    if (result.exitCode !== 0) throw new Error('Could not read the engine host resolvers');
    return parseResolvers(result.output);
  }

  /** Replaces the table in one transaction and remembers how it reads back. */
  async apply(): Promise<void> {
    const rules = renderGuard(
      buildGuard({ installId: this.options.installId, resolvers: await this.resolvers() }),
    );
    const result = await runHelper(
      this.options.engine,
      this.options.installId,
      {
        image: this.options.guardImage,
        entrypoint: [
          'sh',
          '-c',
          `set -e; printf '%s\\n' "$GUARD_RULES" | nft -f -; nft list table inet ${this.table}`,
        ],
        env: [`GUARD_RULES=${rules}`],
        network: 'host',
        capAdd: ['NET_ADMIN'],
      },
      this.options.helperTimeoutMs,
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `The firewall refused the guard rules: ${result.output.trim().slice(0, 300)}`,
      );
    }
    this.appliedHash = sha256(result.output);
  }

  /** Whether the table is present and unchanged since it was applied. */
  async verify(): Promise<IGuardResult> {
    if (this.appliedHash === undefined) {
      return { state: 'unverified', detail: 'the guard has not been applied by this process yet' };
    }
    try {
      const listing = await this.listing();
      if (!listing.ok) return { state: 'unverified', detail: 'the guard table is missing' };
      if (sha256(listing.text) !== this.appliedHash) {
        return { state: 'unverified', detail: 'the guard table differs from what was applied' };
      }
      return { state: 'verified' };
    } catch (error) {
      return { state: 'unverified', detail: `cannot read the guard: ${errorMessage(error)}` };
    }
  }

  /** Verifies, reapplies when it is not intact, and verifies again. One at a time. */
  ensure(): Promise<IGuardResult> {
    this.inFlight ??= (async (): Promise<IGuardResult> => {
      try {
        const first = await this.verify();
        if (first.state === 'verified') return first;
        try {
          await this.apply();
        } catch (error) {
          this.appliedHash = undefined;
          return { state: 'unverified', detail: `cannot apply the guard: ${errorMessage(error)}` };
        }
        return await this.verify();
      } finally {
        this.inFlight = undefined;
      }
    })();
    return this.inFlight;
  }
}
