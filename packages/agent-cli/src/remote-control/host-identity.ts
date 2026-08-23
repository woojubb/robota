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
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

import { ensureOwnerOnlyDirectory } from '@robota-sdk/agent-core/node';
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
function defaultHostIdentityPath(): string {
  return join(homedir(), '.robota', 'remote-host-identity.json');
}

async function derive(keyPair: CryptoKeyPair): Promise<IHostIdentity> {
  const publicKeySpki = await exportPublicKey(keyPair.publicKey);
  return { keyPair, publicKeySpki, hostIdentityId: await deriveIdentityId(publicKeySpki) };
}

/**
 * Load the host identity from `filePath`, or generate + persist a fresh one on first run. The file is created
 * exclusively (`wx` → `O_EXCL`) with mode `0600`. A malformed file **throws** (fail-fast) rather than silently
 * minting a new identity — a new identity would force every trusted device to re-pair, so surfacing corruption
 * is the safer failure.
 *
 * The exclusive create is what makes first-run safe against a concurrent second run. `existsSync` + `writeFile`
 * is a TOCTOU pair: if the file appeared in between, (a) `mode` is applied only at CREATION, so the private key
 * would be left at whatever mode the pre-existing file had, and (b) the write would clobber the identity that
 * won the race — silently invalidating every device pinned to it. On `EEXIST` we therefore discard the identity
 * we just generated and adopt the persisted one. The re-entry terminates: the file now exists, so the recursive
 * call takes the load branch.
 */
export async function loadOrCreateHostIdentity(
  filePath: string = defaultHostIdentityPath(),
): Promise<IHostIdentity> {
  // Read first and treat ENOENT as "no identity yet", rather than `existsSync` + read. Two path
  // lookups can disagree; one read cannot. It also keeps the corrupt-file fail-fast distinct from
  // the absent-file case, which an existence check conflates with any other read failure.
  let raw: string | undefined;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`remote host identity file is unreadable: ${filePath}`, { cause });
    }
  }

  if (raw !== undefined) {
    let parsed: IHostIdentityFile;
    try {
      parsed = JSON.parse(raw) as IHostIdentityFile;
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
  // SEC-020: `~/.robota` was created with no mode, so it came out 0755 and every local account
  // could enumerate the host identity, trusted devices and session records it holds. The file
  // itself is written `wx` with 0600 and is never rewritten, so it needs no tightening.
  ensureOwnerOnlyDirectory(dirname(filePath));
  try {
    writeFileSync(filePath, JSON.stringify(file, null, 2), { mode: 0o600, flag: 'wx' });
  } catch (cause) {
    // `EEXIST` is the lost-race signal from `O_EXCL`; anything else is a real write failure.
    if (!(cause instanceof Error) || (cause as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw cause;
    }
    return loadOrCreateHostIdentity(filePath);
  }
  return derive(keyPair);
}
