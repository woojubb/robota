/**
 * The access code of a published agent, kept owner-only in the state directory so it survives
 * restarts: a bookmark keeps working, and the person types the same code after an update.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SERVER_ACCESS_CODE_FILE = 'server-access-code';
export const DEFAULT_GUI_PORT = 7360;
export const DEFAULT_WS_PORT = 7361;

export function serverAccessCodePath(stateDir: string): string {
  return join(stateDir, SERVER_ACCESS_CODE_FILE);
}

/** The kept code, made on first use: 256 random bits, never chosen by a person. */
export function serverAccessCode(stateDir: string): string {
  const path = serverAccessCodePath(stateDir);
  if (!existsSync(path)) {
    writeFileSync(path, `${randomBytes(32).toString('base64url')}\n`, { mode: 0o600, flag: 'wx' });
  }
  if (process.platform !== 'win32' && (statSync(path).mode & 0o077) !== 0) {
    throw new Error(
      `${path} is readable by other users; run \`chmod 600 ${path}\` and start again`,
    );
  }
  const code = readFileSync(path, 'utf8').trim();
  if (code.length < 32)
    throw new Error(`${path} does not hold an access code; delete it to make a new one`);
  return code;
}

/** A public origin people open the agent at: http or https, a host, and nothing after it. */
export function parsePublicOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`The public URL "${value}" is not a URL, such as https://agent.example.com`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error('The public URL must start with https:// (or http:// behind a test proxy)');
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || url.username !== '')
    throw new Error('The public URL is the site only, such as https://agent.example.com');
  return url.origin;
}

export function parsePort(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`${name} must be a port number`);
  return port;
}
