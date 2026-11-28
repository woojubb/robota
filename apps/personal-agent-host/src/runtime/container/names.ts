import type { ISubnetPool } from '../../config.js';

/** Every engine object of a unit carries these labels; listing and verification go by them. */
export const LABEL_INSTALL = 'robota.personal-agent-host.install';
export const LABEL_ACCOUNT = 'robota.personal-agent-host.account';
export const LABEL_SLOT = 'robota.personal-agent-host.slot';
export const LABEL_KIND = 'robota.personal-agent-host.kind';

/**
 * An image built by `docker compose` carries that project's labels, and a container made from it
 * inherits them, so `compose down` or `ps` would treat a unit as one of the bundle's own services.
 * A container's own label wins over its image's, so these blank values keep every unit and helper
 * out of any compose project.
 */
export const DETACH_FROM_COMPOSE: Readonly<Record<string, string>> = {
  'com.docker.compose.project': '',
  'com.docker.compose.service': '',
  'com.docker.compose.version': '',
};

/** The ports the agent publishes inside its unit; the in-unit forwarder listens on the same ones. */
export const GUI_PORT = 7360;
export const WS_PORT = 7361;
/** Where the agent keeps its state, and so where the one volume is mounted. */
export const STATE_PATH = '/home/node/.personal';
export const ACCESS_CODE_FILE = 'server-access-code';

/** The variable the host sets so the image runs its ingress forwarder; its value is the unit's address. */
export const INGRESS_VARIABLE = 'PERSONAL_AGENT_INGRESS_ADDR';
/** The variable whose name the agent is told holds the model key. */
export const API_KEY_VARIABLE = 'PERSONAL_AGENT_MODEL_API_KEY';

const SLOT_SIZE = 8;
const BRIDGE_SLOT_DIGITS = 3;

export function objectName(installId: string, account: string): string {
  return `pah-${installId}-${account}`;
}

/**
 * The engine reference that keeps an image an account is recorded to run alive. An image known only
 * by its id is removed with its last container once its tag has moved, and a rollback or a restart
 * needs it to still exist.
 */
export function retainReference(installId: string, imageId: string): string {
  return `pah-${installId}-images:${imageId.replace(/^sha256:/u, '').slice(0, 12)}`;
}

export function volumeName(installId: string, account: string): string {
  return `${objectName(installId, account)}-state`;
}

/** Linux interface names are at most 15 characters: `pah`, six hex of the install id, three of the slot. */
export function bridgePrefix(installId: string): string {
  return `pah${installId.slice(0, 6)}`;
}

export function bridgeName(installId: string, slot: number): string {
  return `${bridgePrefix(installId)}${slot.toString(36).padStart(BRIDGE_SLOT_DIGITS, '0')}`;
}

export function ipFromInt(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');
}

export function ipToInt(ip: string): number | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/u.test(part) || Number(part) > 255) return undefined;
    value = value * 256 + Number(part);
  }
  return value;
}

export interface IAccountNetwork {
  cidr: string;
  network: number;
  gateway: string;
  unit: string;
}

/** The /29 of a slot: network, gateway on the bridge, then the unit's static address. */
export function accountNetwork(pool: ISubnetPool, slot: number): IAccountNetwork | undefined {
  if (!Number.isInteger(slot) || slot < 0 || slot >= pool.slots) return undefined;
  const network = pool.network + slot * SLOT_SIZE;
  return {
    cidr: `${ipFromInt(network)}/29`,
    network,
    gateway: ipFromInt(network + 1),
    unit: ipFromInt(network + 2),
  };
}

/** The slot a unit address belongs to, or undefined when it lies outside the pool. */
export function slotOfAddress(pool: ISubnetPool, address: string): number | undefined {
  const value = ipToInt(address);
  if (value === undefined) return undefined;
  const offset = value - pool.network;
  if (offset < 0 || offset >= pool.slots * SLOT_SIZE) return undefined;
  return Math.floor(offset / SLOT_SIZE);
}

/** Whether two CIDR blocks share an address. */
export function cidrsOverlap(a: string, b: string): boolean {
  const parse = (cidr: string): [number, number] | undefined => {
    const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/u.exec(cidr);
    const base = match ? ipToInt(match[1]) : undefined;
    if (!match || base === undefined) return undefined;
    const size = 2 ** (32 - Number(match[2]));
    return [Math.floor(base / size) * size, size];
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return false;
  return left[0] < right[0] + right[1] && right[0] < left[0] + left[1];
}
