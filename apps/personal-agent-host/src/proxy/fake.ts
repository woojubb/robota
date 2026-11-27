import { createHash } from 'node:crypto';

import type { IProxyApplied, IProxyPort, ProxySite } from './port.js';

/** Records the sites it was asked to serve; there is no real proxy behind it. */
export class FakeProxy implements IProxyPort {
  private current: ProxySite[] = [];
  private failure: Error | undefined;
  /** Every applied list, oldest first. */
  readonly history: ProxySite[][] = [];

  failNext(error: Error = new Error('injected proxy failure')): void {
    this.failure = error;
  }

  async apply(sites: readonly ProxySite[]): Promise<IProxyApplied> {
    if (this.failure) {
      const error = this.failure;
      this.failure = undefined;
      throw error;
    }
    this.current = structuredClone([...sites]);
    this.history.push(structuredClone(this.current));
    const body = JSON.stringify([...sites].sort((a, b) => a.hostname.localeCompare(b.hostname)));
    return { hash: createHash('sha256').update(body).digest('hex').slice(0, 16) };
  }

  sites(): readonly ProxySite[] {
    return this.current;
  }

  siteFor(hostname: string): ProxySite | undefined {
    return this.current.find((s) => s.hostname === hostname);
  }
}
