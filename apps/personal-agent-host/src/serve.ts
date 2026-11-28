import { join } from 'node:path';

import { adminPaths } from './admin/paths.js';
import { createAdminServer } from './admin/server.js';
import { bindAdminSocket } from './admin/socket.js';
import { SecretStore } from './accounts/secret-store.js';
import { AccountStore } from './accounts/store.js';
import { Spool } from './archive/spool.js';
import { AuditLog } from './audit.js';
import { ALLOW_CONTAINER_SETTING, type IHostConfig, loadConfig } from './config.js';
import { ControlPlane } from './control-plane.js';
import { errorMessage, HostError } from './errors.js';
import { CaddyProxy, unixSocketTransport } from './proxy/caddy.js';
import { FakeProxy } from './proxy/fake.js';
import type { IProxyPort } from './proxy/port.js';
import { FakeRuntime } from './runtime/fake.js';
import { ContainerRuntime } from './runtime/container/backend.js';
import { EngineClient } from './runtime/container/engine-client.js';
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

/** The configured proxy when the operator named one, else the in-memory fake that serves nothing. */
function chooseProxy(
  config: IHostConfig,
  options: IServeOptions,
  log: (line: string) => void,
): IProxyPort {
  if (options.proxy) return options.proxy;
  if (config.proxy) {
    const { configPath, adminSocket, adminListen } = config.proxy;
    log(`Proxy: configuration ${configPath}, admin socket ${adminSocket}`);
    return new CaddyProxy({
      configPath,
      transport: unixSocketTransport(adminSocket),
      settings: {
        tls: config.tls,
        adminListen,
        ...(config.httpPort !== undefined ? { httpPort: config.httpPort } : {}),
        ...(config.httpsPort !== undefined ? { httpsPort: config.httpsPort } : {}),
      },
    });
  }
  log('WARNING: no proxy is configured; accounts run but no site is served');
  return new FakeProxy();
}

function chooseBackend(
  env: NodeJS.ProcessEnv,
  config: IHostConfig,
  installId: string,
  options: IServeOptions,
  log: (line: string) => void,
): { runtime: IRuntimePort; proxy: IProxyPort } {
  if (options.runtime) {
    return { runtime: options.runtime, proxy: chooseProxy(config, options, log) };
  }
  if (!fakeAllowed(env)) {
    // Containers share the host's kernel, so the backend runs only when the operator has said the
    // accounts are trusted, and only with the image that applies the network guard.
    if (config.allowContainer && config.guardImage !== undefined) {
      log(
        `Container backend: accounts share this engine's kernel and are for trusted people only; ` +
          `engine ${config.engineEndpoint}`,
      );
      return {
        runtime: new ContainerRuntime({
          engine: new EngineClient({ endpoint: config.engineEndpoint }),
          installId,
          subnetPool: config.subnetPool,
          guardImage: config.guardImage,
          ...(config.dnsServers ? { resolvers: config.dnsServers } : {}),
        }),
        proxy: chooseProxy(config, options, log),
      };
    }
    throw new HostError(
      'refused',
      'No runtime backend is available. The container backend runs only for trusted accounts: set ' +
        `${ALLOW_CONTAINER_SETTING}=true and PERSONAL_AGENT_HOST_GUARD_IMAGE (an image with the firewall tool). ` +
        `For tests and development only, ${FAKE_RUNTIME_SETTING}=true serves with an in-memory fake`,
    );
  }
  log(
    `WARNING: ${FAKE_RUNTIME_SETTING} is set; units are in-memory fakes and nothing is isolated or proxied`,
  );
  return { runtime: new FakeRuntime(), proxy: chooseProxy(config, options, log) };
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
  const paths = adminPaths({ PERSONAL_AGENT_HOST_STATE_DIR: config.stateDir });

  const store = await AccountStore.open(config.stateDir);
  const { runtime, proxy } = chooseBackend(env, config, store.installId, options, log);
  const secrets = await SecretStore.open(config.stateDir);
  const audit = await AuditLog.open(join(config.stateDir, 'audit.log'));
  const spool = await Spool.open(config.stateDir);
  const plane = new ControlPlane({ config, store, secrets, audit, runtime, proxy, spool });

  let open!: () => void;
  const ready = new Promise<void>((resolve) => {
    open = resolve;
  });
  const server = createAdminServer({ plane, audit, ready });
  const bound = await bindAdminSocket(server, paths);
  // Holding the lock, nothing in the spool can belong to a running server: it is what a crash left.
  await spool.clear();

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
