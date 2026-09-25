import type { IKeyringModule } from '../keychain-credential-store.js';

/** What a test can make the fake keychain do; each failure throws the way the native binding does. */
export interface IFakeKeyringControls {
  readonly entries: Map<string, string>;
  /** Options each entry was constructed with, in order. */
  readonly constructedWith: unknown[];
  failConstruct?: string;
  failGet?: string;
  failSet?: string;
  failDelete?: string;
  /** Accept a set and then not keep it, as a keychain that silently drops writes would. */
  dropWrites?: boolean;
}

/**
 * An in-memory stand-in for `@napi-rs/keyring`'s `AsyncEntry`, so no test touches the real keychain.
 * A failure message may carry the password, which is exactly what a store must not pass on.
 */
export function createFakeKeyring(): { module: IKeyringModule; controls: IFakeKeyringControls } {
  const controls: IFakeKeyringControls = { entries: new Map(), constructedWith: [] };
  class AsyncEntry {
    private readonly id: string;
    constructor(service: string, account: string, options?: unknown) {
      controls.constructedWith.push(options);
      if (controls.failConstruct !== undefined) throw new Error(controls.failConstruct);
      this.id = `${service}\u0000${account}`;
    }
    async getPassword(): Promise<string | undefined> {
      if (controls.failGet !== undefined) throw new Error(controls.failGet);
      return controls.entries.get(this.id);
    }
    async setPassword(password: string): Promise<void> {
      if (controls.failSet !== undefined) {
        throw new Error(`${controls.failSet} while storing ${password}`);
      }
      if (controls.dropWrites === true) return;
      controls.entries.set(this.id, password);
    }
    async deletePassword(): Promise<boolean> {
      if (controls.failDelete !== undefined) throw new Error(controls.failDelete);
      return controls.entries.delete(this.id);
    }
  }
  return { module: { AsyncEntry }, controls };
}
