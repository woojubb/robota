import { HostError } from '../errors.js';

/**
 * Every value that reaches the generated proxy configuration is checked here first. A value that
 * fails is refused outright: the generator never escapes or repairs, so no input can add a line,
 * a directive or a placeholder to the configuration.
 */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const EMAIL = /^[A-Za-z0-9._+-]{1,64}@[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?\.[a-z]{2,63}$/u;
const SOCKET_PATH = /^\/[A-Za-z0-9._/-]{1,200}$/u;

function refuse(what: string, detail: string): never {
  throw new HostError('invalid-input', `Proxy configuration refused: ${what} ${detail}`);
}

export function isDnsName(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false;
  return value.split('.').every((label) => LABEL.test(label));
}

function lastLabelNumeric(value: string): boolean {
  return /^\d+$/u.test(value.slice(value.lastIndexOf('.') + 1));
}

/** A served hostname: at least two lowercase DNS labels, and never one that reads as an IP address. */
export function validateHostname(value: unknown): string {
  if (typeof value !== 'string' || !isDnsName(value) || !value.includes('.')) {
    return refuse('hostname', 'must be at least two lowercase DNS labels');
  }
  if (lastLabelNumeric(value)) return refuse('hostname', 'must not end in a numeric label');
  return value;
}

function isIpv4(value: string): boolean {
  const parts = value.split('.');
  return (
    parts.length === 4 && parts.every((p) => /^(?:0|[1-9]\d{0,2})$/u.test(p) && Number(p) <= 255)
  );
}

export function validatePort(value: unknown, what = 'port'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    return refuse(what, 'must be a whole number from 1 to 65535');
  }
  return value;
}

/** An upstream, `host:port`, where the host is an IPv4 address or a DNS name; never empty or a wildcard. */
export function validateUpstream(value: unknown): string {
  if (typeof value !== 'string') return refuse('upstream', 'must be text');
  const match = /^([^:]+):(\d{1,5})$/u.exec(value);
  if (!match) return refuse('upstream', 'must be host:port');
  const [, host, port] = match;
  const named = isDnsName(host) && !lastLabelNumeric(host);
  if (!isIpv4(host) && !named) {
    return refuse('upstream', 'must name an IPv4 address or a DNS name');
  }
  if (Number(port) < 1 || Number(port) > 65535 || String(Number(port)) !== port) {
    return refuse('upstream', 'has a port outside 1 to 65535');
  }
  return value;
}

export function validateEmail(value: unknown): string {
  if (typeof value !== 'string' || !EMAIL.test(value)) {
    return refuse('ACME email', 'must be a plain email address');
  }
  return value;
}

/** An absolute path of safe characters only, so it cannot carry a permission suffix or a separator. */
export function validateSocketPath(value: unknown, what: string): string {
  if (typeof value !== 'string' || !SOCKET_PATH.test(value) || value.includes('..')) {
    return refuse(what, 'must be an absolute path of letters, digits, dots, hyphens and slashes');
  }
  return value;
}
