/**
 * Host identity keypair for TOFU trusted-device reconnect (REMOTE-012 Stage E3).
 *
 * The host is the stationary trust anchor: it must reload and sign reconnect challenges across process
 * restarts, so — unlike the browser device key (non-extractable in IndexedDB) — its ECDSA identity keypair is
 * generated **extractable** and persisted as a `0600` JWK file under `~/.robota` (exactly like an SSH host
 * key). Confidentiality of that file buys an attacker nothing they don't already have: read access to
 * `~/.robota` means control of the host process, which IS the agent. The device pins this host's PUBLIC key
 * at first pair and verifies it on every reconnect (rogue-host defense).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  deriveIdentityId,
  exportKeyPairJwk,
  exportPublicKey,
  generateIdentityKeyPair,
  importKeyPairJwk,
  type IIdentityKeyPairJwk,
} from '@robota-sdk/agent-remote-pairing';

/** The loaded host identity: the keypair plus its pinned-value derivatives. */
export interface IHostIdentity {
  /** The host's ECDSA identity keypair (private key signs reconnect challenges). */
  readonly keyPair: CryptoKeyPair;
  /** base64url SPKI public key — advertised to a device at first pair for pinning. */
  readonly publicKeySpki: string;
  /** Stable `SHA-256(SPKI)` id — the value the browser credential store keys on. */
  readonly hostIdentityId: string;
}

interface IHostIdentityFile {
  readonly version: 1;
  readonly keyPair: IIdentityKeyPairJwk;
}

/** Default on-disk location for the host identity JWK. */
export function defaultHostIdentityPath(): string {
  return join(homedir(), '.robota', 'remote-host-identity.json');
}

async function derive(keyPair: CryptoKeyPair): Promise<IHostIdentity> {
  const publicKeySpki = await exportPublicKey(keyPair.publicKey);
  return { keyPair, publicKeySpki, hostIdentityId: await deriveIdentityId(publicKeySpki) };
}

/**
 * Load the host identity from `filePath`, or generate + persist a fresh one on first run. The file is written
 * `0600`. A malformed file **throws** (fail-fast) rather than silently minting a new identity — a new
 * identity would force every trusted device to re-pair, so surfacing corruption is the safer failure.
 */
export async function loadOrCreateHostIdentity(
  filePath: string = defaultHostIdentityPath(),
): Promise<IHostIdentity> {
  if (existsSync(filePath)) {
    let parsed: IHostIdentityFile;
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8')) as IHostIdentityFile;
    } catch (cause) {
      throw new Error(`remote host identity file is corrupt: ${filePath}`, { cause });
    }
    if (parsed.version !== 1 || !parsed.keyPair?.privateJwk || !parsed.keyPair?.publicJwk) {
      throw new Error(`remote host identity file has an unexpected shape: ${filePath}`);
    }
    return derive(await importKeyPairJwk(parsed.keyPair));
  }

  const keyPair = await generateIdentityKeyPair(true);
  const file: IHostIdentityFile = { version: 1, keyPair: await exportKeyPairJwk(keyPair) };
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(file, null, 2), { mode: 0o600 });
  return derive(keyPair);
}
