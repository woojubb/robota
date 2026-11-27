import { join } from 'node:path';

import { adminPaths } from './admin/paths.js';
import { createAdminServer } from './admin/server.js';
import { bindAdminSocket } from './admin/socket.js';
import { SecretStore } from './accounts/secret-store.js';
import { AccountStore } from './accounts/store.js';
import { AuditLog } from './audit.js';
import { type IHostConfig, loadConfig } from './config.js';
import { ControlPlane } from './control-plane.js';
import { errorMessage, HostError } from './errors.js';
import { FakeProxy } from './proxy/fake.js';
import type { IProxyPort } from './proxy/port.js';
import { FakeRuntime } from './runtime/fake.js';
import type { IRuntimePort } from './runtime/port.js';

/** The only way to serve without a real backend; named so it cannot be set by accident. */
export const FAKE_RUNTIME_SETTING = 'PERSONAL_AGENT_HOST_DEV_FAKE_RUNTIME';
const RECONCILE_SETTING = 'PERSONAL_AGENT_HOST_RECONCILE_SECONDS';
const DEFAULT_RECONCILE_SECONDS = 30;
/** Live connections get this long to finish before shutdown cuts them. */
const DRAIN_MS = 5_000;

export interface IServeOptions {
  log(line: string): void;
  /** A runtime to serve with instead of the configured backend; for tests. */
  runtime?: IRuntimePort;
  proxy?: IProxyPort;
  reconcileMs?: number;
}

export interface IRunningHost {
  config: IHostConfig;
  socket: string;
  plane: ControlPlane;
  /** Stops accepting commands, lets running ones finish, and removes the socket. Idempotent. */
  stop(): Promise<void>;
}

function reconcileMs(env: NodeJS.ProcessEnv): number {
  const raw = (env[RECONCILE_SETTING] ?? '').trim();
  if (raw === '') return DEFAULT_RECONCILE_SECONDS * 1000;
  if (!/^\d+$/u.test(raw) || Number(raw) < 1 || Number(raw) > 3600) {
    throw new HostError(
      'config-invalid',
      `${RECONCILE_SETTING} must be a whole number from 1 to 3600`,
    );
  }
  return Number(raw) * 1000;
}

function fakeAllowed(env: NodeJS.ProcessEnv): boolean {
  const raw = (env[FAKE_RUNTIME_SETTING] ?? '').trim();
  if (raw === '' || raw === 'false' || raw === '0') return false;
  if (raw === 'true' || raw === '1') return true;
  throw new HostError('config-invalid', `${FAKE_RUNTIME_SETTING} must be true or false`);
}

function chooseBackend(
  env: NodeJS.ProcessEnv,
  options: IServeOptions,
  log: (line: string) => void,
): { runtime: IRuntimePort; proxy: IProxyPort } {
  if (options.runtime) {
    return { runtime: options.runtime, proxy: options.proxy ?? new FakeProxy() };
  }
  if (!fakeAllowed(env)) {
    throw new HostError(
      'refused',
      'No runtime backend is available: the container backend is not built into this version. ' +
        `For tests and development only, ${FAKE_RUNTIME_SETTING}=true serves with an in-memory fake`,
    );
  }
  log(
    `WARNING: ${FAKE_RUNTIME_SETTING} is set; units are in-memory fakes and nothing is isolated or proxied`,
  );
  return { runtime: new FakeRuntime(), proxy: options.proxy ?? new FakeProxy() };
}

/**
 * Composes the control plane, binds the admin socket (which doubles as the single-instance lock),
 * finishes what a crash left, and keeps reconciling until stopped.
 */
export async function startServe(
  env: NodeJS.ProcessEnv,
  options: IServeOptions,
): Promise<IRunningHost> {
  const { log } = options;
  const config = loadConfig(env);
  const interval = options.reconcileMs ?? reconcileMs(env);
  const { runtime, proxy } = chooseBackend(env, options, log);
  const paths = adminPaths({ PERSONAL_AGENT_HOST_STATE_DIR: config.stateDir });

  const store = await AccountStore.open(config.stateDir);
  const secrets = await SecretStore.open(config.stateDir);
  const audit = await AuditLog.open(join(config.stateDir, 'audit.log'));
  const plane = new ControlPlane({ config, store, secrets, audit, runtime, proxy });

  let open!: () => void;
  const ready = new Promise<void>((resolve) => {
    open = resolve;
  });
  const server = createAdminServer({ plane, audit, ready });
  const bound = await bindAdminSocket(server, paths);

  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  let pass: Promise<void> = Promise.resolve();

  const reconcileOnce = async (): Promise<void> => {
    try {
      await plane.reconcile();
    } catch (error) {
      log(`reconcile failed: ${errorMessage(error)}`);
    }
  };
  const schedule = (): void => {
    if (stopping) return;
    timer = setTimeout(() => {
      pass = reconcileOnce().then(schedule);
    }, interval);
  };

  try {
    const recovered = await plane.recover();
    if (recovered.length > 0) log(`recovered unfinished accounts: ${recovered.join(', ')}`);
    await reconcileOnce();
  } catch (error) {
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    await closed;
    await bound.release();
    throw error;
  }
  open();
  schedule();
  log(`serving ${config.baseDomain} on ${paths.socket}`);

  let stopped: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopped ??= (async () => {
      stopping = true;
      if (timer) clearTimeout(timer);
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeIdleConnections();
      const cut = setTimeout(() => server.closeAllConnections(), DRAIN_MS);
      await closed;
      clearTimeout(cut);
      await pass;
      await bound.release();
    })();
    return stopped;
  };
  return { config, socket: paths.socket, plane, stop };
}
