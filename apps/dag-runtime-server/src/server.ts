import { timingSafeEqual } from 'node:crypto';
import { serve } from '@hono/node-server';
import { createDagFramework } from '@robota-sdk/dag-framework';

import { createDagRuntimeServer } from './app.js';
import { resolveDagStoragePaths } from './storage-paths.js';

export interface IStartDagRuntimeServerOptions {
  /** Selected product user state root from the host's resolved configuration. */
  userStateRoot: string;
  /** Bearer secret required by every route. Must contain 32 to 256 URL-safe characters. */
  token: string;
  /** Interface to bind. Defaults to IPv4 loopback. */
  host?: string;
  /** Port to bind. Defaults to 3939, or `DAG_RUNTIME_SERVER_PORT`. */
  port?: number;
  /** Explicit environment snapshot for optional host overrides. */
  environment?: Readonly<Record<string, string | undefined>>;
}

export interface IDagRuntimeServerHandle {
  readonly port: number;
  stop(): Promise<void>;
}

/**
 * Start the native DAG runtime HTTP server: composes an in-process DAG framework and serves its
 * orchestration, cost, draft and asset capabilities over `/v1/dag/*` routes.
 * Returns a handle to stop it.
 */
export async function startDagRuntimeServer(
  options: IStartDagRuntimeServerOptions,
): Promise<IDagRuntimeServerHandle> {
  if (!/^[A-Za-z0-9_-]{32,256}$/u.test(options.token)) {
    throw new Error('DAG runtime token must contain 32 to 256 URL-safe characters');
  }
  const environment = options.environment ?? {};
  const envPort = environment['DAG_RUNTIME_SERVER_PORT'];
  const port = options.port ?? (envPort !== undefined ? Number(envPort) : 3939);
  const paths = resolveDagStoragePaths({ userStateRoot: options.userStateRoot, environment });

  const framework = await createDagFramework({
    executionRoot: process.cwd(),
    paths,
  });
  await framework.start();
  const app = createDagRuntimeServer(
    framework.runs,
    framework.costMeta,
    framework.runDrafts,
    framework.build,
    framework.validation,
    framework.catalog,
    framework.definitionReads,
    framework.definitionMutations,
    {
      authorize: (request): boolean => {
        const supplied = request.headers.get('authorization');
        if (supplied === null || !supplied.startsWith('Bearer ')) return false;
        const actual = Buffer.from(supplied.slice('Bearer '.length));
        const expected = Buffer.from(options.token);
        return actual.length === expected.length && timingSafeEqual(actual, expected);
      },
    },
    framework.internals.execution.runProgressEventBus,
    framework.assets,
  );
  const server = serve({ fetch: app.fetch, port, hostname: options.host ?? '127.0.0.1' });
  if ('requestTimeout' in server) server.requestTimeout = 30_000;
  if ('headersTimeout' in server) server.headersTimeout = 10_000;

  return {
    port,
    stop: async (): Promise<void> => {
      server.close();
      await framework.stop();
    },
  };
}
