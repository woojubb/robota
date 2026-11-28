import { isAbsolute } from 'node:path';

import { HostError } from './errors.js';
import type { IUnitLimits } from './runtime/port.js';

export type TlsMode = { mode: 'internal' } | { mode: 'acme'; email: string };

export interface ISubnetPool {
  cidr: string;
  /** Network address as an unsigned 32-bit integer. */
  network: number;
  prefix: number;
  /** How many /29 account networks the pool holds. */
  slots: number;
}

export interface IHostConfig {
  stateDir: string;
  baseDomain: string;
  tls: TlsMode;
  allowContainer: boolean;
  unitImage: string;
  subnetPool: ISubnetPool;
  defaultLimits: IUnitLimits;
  httpPort?: number;
  httpsPort?: number;
  engineEndpoint: string;
  /** An image with the firewall tool, run briefly to apply and check the network guard. */
  guardImage?: string;
  /**
   * Resolvers units may reach for DNS; the engine host's own when absent. When set, the list must
   * match the resolvers the engine forwards to, or units lose name resolution.
   */
  dnsServers?: string[];
}

const PREFIX = 'PERSONAL_AGENT_HOST_';
const ACCOUNT_NETWORK_PREFIX = 29;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
export const IMAGE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}$/u;
/** An account hostname is `<id>.<baseDomain>`; ids are at most 31 characters. */
const MAX_BASE_DOMAIN = 253 - 32;

const DEFAULTS = {
  stateDir: '/var/lib/personal-agent-host',
  engineEndpoint: 'unix:///var/run/docker.sock',
  subnetPool: '10.200.0.0/16',
  memoryMb: 2048,
  cpus: 1,
  pids: 512,
};

function ipToInt(ip: string): number | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/u.test(part) || Number(part) > 255) return undefined;
    value = value * 256 + Number(part);
  }
  return value;
}

const PRIVATE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [ipToInt('10.0.0.0') ?? 0, 8],
  [ipToInt('172.16.0.0') ?? 0, 12],
  [ipToInt('192.168.0.0') ?? 0, 16],
];

function inRange(address: number, [network, prefix]: readonly [number, number]): boolean {
  const size = 2 ** (32 - prefix);
  return address >= network && address < network + size;
}

export function parseSubnetPool(text: string): ISubnetPool | string {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/u.exec(text);
  if (!match) return 'must be an IPv4 CIDR such as 10.200.0.0/16';
  const network = ipToInt(match[1]);
  const prefix = Number(match[2]);
  if (network === undefined) return 'has an invalid IPv4 address';
  if (prefix < 8 || prefix > 24) return 'prefix must be between /8 and /24';
  const size = 2 ** (32 - prefix);
  if (network % size !== 0) return 'network address has host bits set';
  const last = network + size - 1;
  const contained = PRIVATE_RANGES.some((r) => inRange(network, r) && inRange(last, r));
  if (!contained) return 'must lie inside 10.0.0.0/8, 172.16.0.0/12 or 192.168.0.0/16';
  return { cidr: text, network, prefix, slots: 2 ** (ACCOUNT_NETWORK_PREFIX - prefix) };
}

export function validateBaseDomain(value: string): string | undefined {
  if (value.length === 0 || value.length > MAX_BASE_DOMAIN) {
    return `must be 1 to ${MAX_BASE_DOMAIN} characters`;
  }
  const labels = value.split('.');
  if (!labels.every((label) => LABEL.test(label))) {
    return 'must be lowercase DNS labels of letters, digits and hyphens separated by dots';
  }
  if (/^\d+$/u.test(labels[labels.length - 1])) return 'must not end in a numeric label';
  return undefined;
}

class Problems {
  readonly lines: string[] = [];
  add(name: string, message: string): void {
    this.lines.push(`${PREFIX}${name} ${message}`);
  }
}

function integer(
  env: NodeJS.ProcessEnv,
  problems: Problems,
  name: string,
  fallback: number | undefined,
  min: number,
  max: number,
): number | undefined {
  const raw = env[PREFIX + name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/u.test(raw) || Number(raw) < min || Number(raw) > max) {
    problems.add(name, `must be a whole number from ${min} to ${max}`);
    return fallback;
  }
  return Number(raw);
}

function decimal(
  env: NodeJS.ProcessEnv,
  problems: Problems,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[PREFIX + name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!/^\d+(?:\.\d+)?$/u.test(raw) || value < min || value > max) {
    problems.add(name, `must be a number from ${min} to ${max}`);
    return fallback;
  }
  return value;
}

function flag(env: NodeJS.ProcessEnv, problems: Problems, name: string): boolean {
  const raw = env[PREFIX + name];
  if (raw === undefined || raw === '') return false;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  problems.add(name, 'must be true or false');
  return false;
}

function engineEndpoint(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'is not a valid URL';
  }
  if (url.protocol === 'unix:') {
    return isAbsolute(url.pathname) && url.pathname.length > 1
      ? undefined
      : 'must name an absolute socket path, for example unix:///var/run/docker.sock';
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol === 'https:') return url.hostname ? undefined : 'needs a host';
  if (url.protocol === 'http:' && loopback) return undefined;
  return 'must be a unix:// socket, an https:// URL, or http:// on loopback only';
}

/** Reads and validates the whole configuration, refusing with every problem named. */
export function loadConfig(env: NodeJS.ProcessEnv): IHostConfig {
  const problems = new Problems();
  const get = (name: string): string => (env[PREFIX + name] ?? '').trim();

  const baseDomain = get('BASE_DOMAIN');
  if (baseDomain === '')
    problems.add('BASE_DOMAIN', 'is required (the domain accounts live under)');
  else {
    const issue = validateBaseDomain(baseDomain);
    if (issue) problems.add('BASE_DOMAIN', issue);
  }

  const tlsRaw = get('TLS');
  let tls: TlsMode = { mode: 'internal' };
  if (tlsRaw === '') problems.add('TLS', 'is required: an ACME contact email, or "internal"');
  else if (tlsRaw === 'internal') tls = { mode: 'internal' };
  else if (EMAIL.test(tlsRaw)) tls = { mode: 'acme', email: tlsRaw };
  else problems.add('TLS', 'must be an ACME contact email address or "internal"');

  const unitImage = get('UNIT_IMAGE');
  if (unitImage === '') problems.add('UNIT_IMAGE', 'is required (the personal agent image)');
  else if (!IMAGE.test(unitImage)) problems.add('UNIT_IMAGE', 'is not a valid image reference');

  const stateDir = get('STATE_DIR') || DEFAULTS.stateDir;
  if (!isAbsolute(stateDir)) problems.add('STATE_DIR', 'must be an absolute path');

  const poolRaw = get('SUBNET_POOL') || DEFAULTS.subnetPool;
  const pool = parseSubnetPool(poolRaw);
  if (typeof pool === 'string') problems.add('SUBNET_POOL', pool);

  const engine = get('ENGINE_ENDPOINT') || DEFAULTS.engineEndpoint;
  const engineIssue = engineEndpoint(engine);
  if (engineIssue) problems.add('ENGINE_ENDPOINT', engineIssue);

  const guardImage = get('GUARD_IMAGE');
  if (guardImage !== '' && !IMAGE.test(guardImage)) {
    problems.add('GUARD_IMAGE', 'is not a valid image reference');
  }
  const dnsRaw = get('DNS_SERVERS');
  const dnsServers = dnsRaw === '' ? [] : dnsRaw.split(',').map((entry) => entry.trim());
  for (const server of dnsServers) {
    if (ipToInt(server) === undefined) {
      problems.add(
        'DNS_SERVERS',
        `must be a comma-separated list of IPv4 addresses (got "${server}")`,
      );
      break;
    }
  }

  const httpPort = integer(env, problems, 'HTTP_PORT', undefined, 1, 65535);
  const httpsPort = integer(env, problems, 'HTTPS_PORT', undefined, 1, 65535);
  if (httpPort !== undefined && httpPort === httpsPort) {
    problems.add('HTTPS_PORT', 'must differ from PERSONAL_AGENT_HOST_HTTP_PORT');
  }

  const defaultLimits: IUnitLimits = {
    memoryMb: integer(env, problems, 'MEMORY_MB', DEFAULTS.memoryMb, 64, 1_048_576) ?? 0,
    cpus: decimal(env, problems, 'CPUS', DEFAULTS.cpus, 0.1, 256),
    pids: integer(env, problems, 'PIDS', DEFAULTS.pids, 16, 1_000_000) ?? 0,
  };
  const allowContainer = flag(env, problems, 'ALLOW_CONTAINER');

  if (problems.lines.length > 0 || typeof pool === 'string') {
    throw new HostError(
      'config-invalid',
      `Invalid configuration:\n${problems.lines.map((l) => `  - ${l}`).join('\n')}`,
    );
  }
  return {
    stateDir,
    baseDomain,
    tls,
    allowContainer,
    unitImage,
    subnetPool: pool,
    defaultLimits,
    ...(httpPort !== undefined ? { httpPort } : {}),
    ...(httpsPort !== undefined ? { httpsPort } : {}),
    engineEndpoint: engine,
    ...(guardImage !== '' ? { guardImage } : {}),
    ...(dnsServers.length > 0 ? { dnsServers } : {}),
  };
}

/** The address people open for an account: the HTTPS port is shown only when it is not 443. */
export function publicOrigin(config: IHostConfig, hostname: string): string {
  const port = config.httpsPort;
  return port !== undefined && port !== 443 ? `https://${hostname}:${port}` : `https://${hostname}`;
}

export const ALLOW_CONTAINER_SETTING = `${PREFIX}ALLOW_CONTAINER`;
