import { HostError } from '../errors.js';
import type { IProviderInfo, IUnitLimits, RuntimeBackend } from '../runtime/port.js';
import type { AccountState, IAccountRecord, KeySource } from './types.js';

/** A DNS label that is also safe in a container name. */
export const ACCOUNT_ID_PATTERN = /^[a-z](?:[a-z0-9-]{0,29}[a-z0-9])?$/u;

const STATES: readonly AccountState[] = ['provisioning', 'active', 'suspended', 'deleting'];
const KEY_SOURCES: readonly KeySource[] = ['account', 'operator', 'none'];
const BACKENDS: readonly RuntimeBackend[] = ['container', 'vm'];
const PROVIDER_TYPE = /^[a-z][a-z0-9-]{0,31}$/u;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

export function validateAccountId(id: unknown): string {
  if (typeof id !== 'string' || !ACCOUNT_ID_PATTERN.test(id)) {
    throw new HostError(
      'invalid-input',
      'Account id must be 1 to 31 characters: a lowercase letter first, then lowercase letters, ' +
        'digits or hyphens, not ending in a hyphen',
    );
  }
  return id;
}

export function hostnameFor(id: string, baseDomain: string): string {
  return `${id}.${baseDomain}`;
}

function fail(message: string): never {
  throw new HostError('invalid-input', message);
}

export function validateProvider(value: unknown): IProviderInfo {
  if (typeof value !== 'object' || value === null) fail('Provider must be an object');
  const { type, model, baseUrl } = value as Record<string, unknown>;
  if (typeof type !== 'string' || !PROVIDER_TYPE.test(type)) {
    fail('Provider type must be lowercase letters, digits or hyphens, starting with a letter');
  }
  const out: IProviderInfo = { type };
  if (model !== undefined) {
    if (
      typeof model !== 'string' ||
      model.length === 0 ||
      model.length > 128 ||
      CONTROL.test(model)
    ) {
      fail('Provider model must be 1 to 128 printable characters');
    }
    out.model = model;
  }
  if (baseUrl !== undefined) {
    if (typeof baseUrl !== 'string') fail('Provider base URL must be a string');
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      return fail('Provider base URL is not a valid URL');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      fail('Provider base URL must use http or https');
    }
    if (url.username !== '' || url.password !== '') {
      fail('Provider base URL must not carry credentials; the key is supplied separately');
    }
    out.baseUrl = baseUrl;
  }
  return out;
}

function boundedNumber(
  value: unknown,
  name: string,
  min: number,
  max: number,
  whole: boolean,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`Limit ${name} must be a number from ${min} to ${max}`);
  }
  if (whole && !Number.isInteger(value)) fail(`Limit ${name} must be a whole number`);
  return value;
}

export function validateLimits(value: unknown): IUnitLimits {
  if (typeof value !== 'object' || value === null) fail('Limits must be an object');
  const { memoryMb, cpus, pids } = value as Record<string, unknown>;
  return {
    memoryMb: boundedNumber(memoryMb, 'memoryMb', 64, 1_048_576, true),
    cpus: boundedNumber(cpus, 'cpus', 0.1, 256, false),
    pids: boundedNumber(pids, 'pids', 16, 1_000_000, true),
  };
}

export function validateKeySource(value: unknown): KeySource {
  if (!KEY_SOURCES.includes(value as KeySource))
    fail('Key source must be account, operator or none');
  return value as KeySource;
}

export function validateBackend(value: unknown): RuntimeBackend {
  if (!BACKENDS.includes(value as RuntimeBackend)) fail('Backend must be container or vm');
  return value as RuntimeBackend;
}

/** A model key arrives from stdin or a prompt, so only its shape is checked, never its value. */
export function validateApiKey(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4096 ||
    CONTROL.test(value)
  ) {
    fail('The model key must be 1 to 4096 printable characters');
  }
  return value;
}

/** Checks a stored record; a failure means the store was damaged or edited by hand. */
export function parseAccountRecord(value: unknown, where: string): IAccountRecord {
  const corrupt = (message: string): never => {
    throw new HostError('store-corrupt', `${where}: ${message}`);
  };
  if (typeof value !== 'object' || value === null) return corrupt('record is not an object');
  const r = value as Record<string, unknown>;
  try {
    const id = validateAccountId(r.id);
    if (
      typeof r.hostname !== 'string' ||
      !r.hostname.startsWith(`${id}.`) ||
      r.hostname.length > 253
    ) {
      corrupt('hostname must be <id>.<domain>');
    }
    if (!STATES.includes(r.state as AccountState)) corrupt('unknown state');
    if (typeof r.image !== 'string' || r.image.length === 0) corrupt('image is missing');
    if (typeof r.createdAt !== 'string' || !TIMESTAMP.test(r.createdAt))
      corrupt('createdAt is invalid');
    if (typeof r.updatedAt !== 'string' || !TIMESTAMP.test(r.updatedAt))
      corrupt('updatedAt is invalid');
    if (!Number.isInteger(r.subnetSlot) || (r.subnetSlot as number) < 0)
      corrupt('subnetSlot is invalid');
    return {
      id,
      hostname: r.hostname as string,
      backend: validateBackend(r.backend),
      state: r.state as AccountState,
      provider: validateProvider(r.provider),
      keySource: validateKeySource(r.keySource),
      limits: validateLimits(r.limits),
      subnetSlot: r.subnetSlot as number,
      image: r.image as string,
      createdAt: r.createdAt as string,
      updatedAt: r.updatedAt as string,
    };
  } catch (error) {
    if (error instanceof HostError && error.code === 'invalid-input') {
      return corrupt(error.message);
    }
    throw error;
  }
}
