/**
 * Host trusted-device store for TOFU reconnect (REMOTE-012 Stage E3).
 *
 * A JSON file under `~/.robota` keyed by `deviceId`, holding each enrolled device's **public** key only — no
 * private material, so a leak of this file cannot impersonate a device. Enrollment happens at first pair
 * (after the explicit host accept); reconnect looks a device up by id and authenticates it against its pinned
 * public key. Corruption **throws** (fail-fast, mirroring `settings-io`'s `SettingsParseError`) — a truncated
 * trust store must surface, never be silently read as an empty allow-list that would force every device to
 * re-pair or, worse, mask tampering.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** One enrolled device. `publicKey` is a base64url SPKI; timestamps are ISO-8601 strings supplied by the caller. */
export interface ITrustedDeviceRecord {
  readonly deviceId: string;
  readonly publicKey: string;
  readonly label: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  /** REMOTE-013 E4: per-device reconnect seed (HKDF of the pairing sessionKey) for rotating-rendezvous rediscovery. */
  readonly reconnectSeed?: string;
  /** REMOTE-013 E4: monotonic reconnect counter (resync-on-success). Absent → 0. */
  readonly reconnectCounter?: number;
}

export interface ITrustedDeviceStore {
  /** All enrolled devices (public data only). */
  list(): ITrustedDeviceRecord[];
  /** The record for `deviceId`, or undefined when unknown/revoked. */
  get(deviceId: string): ITrustedDeviceRecord | undefined;
  /** Insert or replace a device record (enroll on first pair / bump `lastSeenAt` on reconnect). */
  upsert(record: ITrustedDeviceRecord): void;
  /** Remove a device; returns true if one was removed. A revoked device must re-pair. */
  revoke(deviceId: string): boolean;
}

interface ITrustedDeviceFile {
  readonly version: 1;
  readonly devices: Record<string, ITrustedDeviceRecord>;
}

/** Default on-disk location for the trusted-device store. */
function defaultTrustedDeviceStorePath(): string {
  return join(homedir(), '.robota', 'remote-trusted-devices.json');
}

function readFile(filePath: string): ITrustedDeviceFile {
  if (!existsSync(filePath)) return { version: 1, devices: {} };
  let parsed: ITrustedDeviceFile;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8')) as ITrustedDeviceFile;
  } catch (cause) {
    throw new Error(`remote trusted-device store is corrupt: ${filePath}`, { cause });
  }
  if (parsed.version !== 1 || typeof parsed.devices !== 'object' || parsed.devices === null) {
    throw new Error(`remote trusted-device store has an unexpected shape: ${filePath}`);
  }
  return parsed;
}

function writeFile(filePath: string, file: ITrustedDeviceFile): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(file, null, 2), { mode: 0o600 });
}

/**
 * Create a file-backed trusted-device store. Reads are fresh from disk per call (small store; consistent with
 * `settings-io`), so an external edit or `revoke` is seen immediately.
 */
export function createTrustedDeviceStore(
  filePath: string = defaultTrustedDeviceStorePath(),
): ITrustedDeviceStore {
  return {
    list(): ITrustedDeviceRecord[] {
      return Object.values(readFile(filePath).devices);
    },
    get(deviceId: string): ITrustedDeviceRecord | undefined {
      return readFile(filePath).devices[deviceId];
    },
    upsert(record: ITrustedDeviceRecord): void {
      const file = readFile(filePath);
      writeFile(filePath, {
        version: 1,
        devices: { ...file.devices, [record.deviceId]: record },
      });
    },
    revoke(deviceId: string): boolean {
      const file = readFile(filePath);
      if (!(deviceId in file.devices)) return false;
      const devices = { ...file.devices };
      delete devices[deviceId];
      writeFile(filePath, { version: 1, devices });
      return true;
    },
  };
}
