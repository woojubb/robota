import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync } from 'node:fs';

import {
  assertSameStablePosixRootDescriptor,
  assertSameStableRoot,
  createStableRootedFileReader,
} from '@robota-sdk/agent-os/file-authority';

import { SyncWorkspaceRootBrokerClient } from '../startup/workspace-root-broker-sync.js';

import type { IStableRootedFileReader } from '@robota-sdk/agent-os/file-authority';

/** Independent live root held by a secure owner or runtime, with the broker generation at admission. */
export class SecureWorkspaceRootFence {
  readonly #root: string;
  readonly #reader: IStableRootedFileReader;
  readonly #descriptor: number;
  readonly #broker: SyncWorkspaceRootBrokerClient;
  readonly #generation: number;
  readonly #tag: string;
  readonly #trustTag: string;
  readonly #requireTrusted: boolean;
  readonly #restrictedHold: string | undefined;
  #closed = false;

  constructor(root: string, brokerEndpoint: string, requireTrusted: boolean, restrictedHold?: string) {
    if (process.platform !== 'darwin' && process.platform !== 'linux') {
      throw new Error('Secure workspace identity is unavailable on this platform.');
    }
    const reader = createStableRootedFileReader(root);
    let descriptor: number | undefined;
    const broker = new SyncWorkspaceRootBrokerClient(brokerEndpoint);
    try {
      descriptor = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      assertSameStablePosixRootDescriptor(reader, descriptor);
      const stat = fstatSync(descriptor, { bigint: true });
      if (!stat.isDirectory() || stat.ino === 0n) throw new Error('The workspace root identity is unavailable.');
      const response = broker.request({ op: 'inspect', root });
      if (response.status !== 'trusted' && response.status !== 'untrusted' &&
          response.status !== 'revoked' && response.status !== 'stale/replaced') {
        throw new Error('The workspace broker could not inspect the root.');
      }
      if (requireTrusted && response.status !== 'trusted') {
        throw new Error('The trusted workspace root is unavailable.');
      }
      this.#root = root;
      this.#reader = reader;
      this.#descriptor = descriptor;
      this.#broker = broker;
      this.#generation = response.generation;
      this.#tag = `${stat.dev}:${stat.ino}`;
      this.#trustTag = response.status === 'trusted'
        ? createHash('sha256').update(response.lease).digest('hex') : response.status;
      this.#requireTrusted = requireTrusted;
      this.#restrictedHold = restrictedHold;
      if (restrictedHold) this.assertCurrent();
    } catch (error) {
      broker.close();
      if (descriptor !== undefined) closeSync(descriptor);
      reader.close();
      throw error;
    }
  }

  proof(): { readonly tag: string; readonly generation: number; readonly trustTag: string } {
    this.assertCurrent();
    return { tag: this.#tag, generation: this.#generation, trustTag: this.#trustTag };
  }

  assertPhysicalRoot(): void {
    if (this.#closed) throw new Error('The workspace root fence is closed.');
    const named = createStableRootedFileReader(this.#root);
    try { assertSameStableRoot(this.#reader, named); }
    finally { named.close(); }
    assertSameStablePosixRootDescriptor(this.#reader, this.#descriptor);
  }

  assertCurrent(): void {
    this.assertPhysicalRoot();
    const response = this.#broker.request({ op: 'inspect', root: this.#root });
    if ((response.status !== 'trusted' && response.status !== 'untrusted' &&
         response.status !== 'revoked' && response.status !== 'stale/replaced') ||
        response.generation !== this.#generation ||
        (response.status === 'trusted' ? createHash('sha256').update(response.lease).digest('hex') : response.status) !== this.#trustTag ||
        (this.#requireTrusted && response.status !== 'trusted')) {
      throw new Error('The workspace root or trust generation changed.');
    }
    if (this.#restrictedHold) {
      const held = this.#broker.request({ op: 'assertRestricted', root: this.#root, hold: this.#restrictedHold });
      if (held.status !== 'restricted-root' || held.tag !== this.#tag) {
        throw new Error('The Restricted folder changed after approval.');
      }
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#broker.close();
    closeSync(this.#descriptor);
    this.#reader.close();
  }
}
