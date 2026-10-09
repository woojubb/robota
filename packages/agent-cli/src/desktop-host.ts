import { join } from 'node:path';

import { embeddedProductIdentity, productConfigEntries, scopeProductEnvironment } from '@robota-sdk/product-config';

import { createProductCliHost } from './product-host.js';

import type { TConfigEnvironment } from '@robota-sdk/product-config';
import type { IProductCliArtifact } from './product/artifact.js';

export interface IDesktopCliResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}
export interface IDesktopTrustQuestion {
  readonly folder: string;
  readonly loads: readonly string[];
}
export type TDesktopTrustChoice = 'trust' | 'restricted' | 'quit';
export interface IDesktopDaemonEndpoint {
  readonly id: string;
  readonly url: string;
  readonly port: number;
}
export type TDesktopAttachment =
  | { readonly ok: true; readonly endpoint: IDesktopDaemonEndpoint }
  | { readonly ok: false; readonly detail: string };

export interface IDesktopCliControllerOptions {
  readonly artifact: IProductCliArtifact;
  /** Snapshot supplied by the Electron main process; product aliases are scoped to the artifact. */
  readonly environment: TConfigEnvironment;
  /** The consumer wrapper runs its own packaged CLI executable with these args and curated env. */
  readonly execute: (args: readonly string[], environment: Readonly<Record<string, string>>) => Promise<IDesktopCliResult>;
  /** Main process displays a native trust prompt; no daemon starts until it resolves. */
  readonly chooseTrust: (question: IDesktopTrustQuestion) => Promise<TDesktopTrustChoice>;
}

const OS_VARIABLES = [
  'PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'LANG', 'LC_ALL',
  'XDG_RUNTIME_DIR', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
] as const;
const DAEMON_URL = /^ws:\/\/127\.0\.0\.1:([0-9]{1,5})\/?\?token=([A-Za-z0-9%._~-]+)$/u;

function singleJsonLine(stdout: string): Record<string, unknown> | undefined {
  const lines = stdout.split(/\r?\n/u).filter((line) => line.trim() !== '');
  if (lines.length !== 1) return undefined;
  try {
    const value: unknown = JSON.parse(lines[0]!);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

export function parseDesktopTrustStatus(stdout: string): {
  readonly trusted: boolean;
  readonly question?: IDesktopTrustQuestion;
  readonly providerEnvRefs: readonly string[];
} | undefined {
  const value = singleJsonLine(stdout);
  if (value === undefined) return undefined;
  const refs = value.providerEnvRefs;
  if (refs !== undefined && (!Array.isArray(refs) || refs.length > 128 ||
    !refs.every((name) => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)))) return undefined;
  if (value.state === 'trusted') {
    if (value.askable !== false) return undefined;
    return { trusted: true, providerEnvRefs: Object.freeze([...(new Set((refs ?? []) as string[]))]) };
  }
  if (value.askable === true && typeof value.workspace === 'string' && value.workspace.trim() !== '') {
    const loads = Array.isArray(value.loads) ? value.loads.filter((row): row is string => typeof row === 'string') : [];
    return { trusted: false, question: { folder: value.workspace, loads: loads.slice(0, 64) }, providerEnvRefs: [] };
  }
  return { trusted: false, providerEnvRefs: [] };
}

export function parseDesktopDaemonStart(stdout: string): IDesktopDaemonEndpoint | undefined {
  const value = singleJsonLine(stdout);
  if (typeof value?.id !== 'string' || value.id.trim() === '' || typeof value.url !== 'string') return undefined;
  const match = DAEMON_URL.exec(value.url);
  if (!match) return undefined;
  const port = Number(match[1]);
  return Number.isInteger(port) && port > 0 && port <= 65_535
    ? { id: value.id, url: value.url, port } : undefined;
}

export function desktopContentSecurityPolicy(port: number | undefined): string {
  const connect = port === undefined ? "'none'" : `ws://127.0.0.1:${port}`;
  return `default-src 'self'; connect-src ${connect}; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'`;
}

/** One attachment owner for initial launch and reconnect. The CLI daemon outlives this controller. */
export function createDesktopCliController(options: IDesktopCliControllerOptions) {
  const environment = Object.freeze({ ...options.environment });
  const runtime = createProductCliHost(options.artifact).resolveRuntime({ environment });
  const config = runtime.config;
  const scoped = scopeProductEnvironment(environment, embeddedProductIdentity(config));
  let latest: Promise<TDesktopAttachment> | null = null;
  let inFlight: Promise<TDesktopAttachment> | null = null;
  let settledPort: number | undefined;
  let restricted = false;

  const childEnvironment = (refs: readonly string[] = []): Record<string, string> => {
    const output: Record<string, string> = {};
    for (const key of OS_VARIABLES) if (scoped[key] !== undefined) output[key] = scoped[key]!;
    for (const key of refs) if (scoped[key] !== undefined) output[key] = scoped[key]!;
    for (const { section, field, descriptor } of productConfigEntries()) {
      if (descriptor.exposure === 'private' || !descriptor.consumers.includes('cli')) continue;
      const value = (config[section] as Readonly<Record<string, unknown>>)[field];
      if (value !== undefined) output[descriptor.variable] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    if (scoped.PRODUCT_CONFIG_FILE !== undefined) output.PRODUCT_CONFIG_FILE = scoped.PRODUCT_CONFIG_FILE;
    return output;
  };

  async function attach(): Promise<TDesktopAttachment> {
    let refs: readonly string[] = [];
    const status = restricted
      ? undefined
      : await options.execute(['trust', 'status', '--json'], childEnvironment());
    const trust = status?.exitCode === 0 ? parseDesktopTrustStatus(status.stdout) : undefined;
    if (!restricted && trust?.question !== undefined) {
      const choice = await options.chooseTrust(trust.question);
      if (choice !== 'trust' && choice !== 'restricted' && choice !== 'quit')
        return { ok: false, detail: 'Desktop trust answer was invalid.' };
      if (choice === 'quit') return { ok: false, detail: 'Desktop launch cancelled.' };
      if (choice === 'restricted') restricted = true;
      if (choice === 'trust') {
        const grant = await options.execute(['trust', '--yes'], childEnvironment());
        if (grant.exitCode !== 0) return { ok: false, detail: grant.stderr.trim() || 'Workspace trust grant failed.' };
        const renewed = await options.execute(['trust', 'status', '--json'], childEnvironment());
        const renewedTrust = renewed.exitCode === 0 ? parseDesktopTrustStatus(renewed.stdout) : undefined;
        if (renewedTrust?.trusted !== true)
          return { ok: false, detail: 'Workspace trust could not be confirmed after grant.' };
        refs = renewedTrust.providerEnvRefs;
      }
    } else refs = trust?.providerEnvRefs ?? [];
    const result = await options.execute(
      ['daemon', 'start', '--json', ...(restricted ? ['--restricted-workspace'] : [])],
      childEnvironment(restricted ? [] : refs),
    );
    const endpoint = result.exitCode === 0 ? parseDesktopDaemonStart(result.stdout) : undefined;
    return endpoint === undefined
      ? { ok: false, detail: result.stderr.trim() || 'Desktop daemon did not return a loopback endpoint.' }
      : { ok: true, endpoint };
  }

  const start = (): Promise<TDesktopAttachment> => {
    if (inFlight !== null) return inFlight;
    const pending = attach().then((result) => {
      settledPort = result.ok ? result.endpoint.port : undefined;
      inFlight = null;
      return result;
    }, (error: unknown) => {
      settledPort = undefined;
      inFlight = null;
      throw error;
    });
    latest = inFlight = pending;
    return pending;
  };

  return Object.freeze({
    config,
    userDataPath: join(config.storage.userRoot, 'desktop'),
    start,
    reconnect: start,
    current: (): Promise<TDesktopAttachment> | null => latest,
    port: (): number | undefined => settledPort,
    csp: (): string => desktopContentSecurityPolicy(settledPort),
  });
}
