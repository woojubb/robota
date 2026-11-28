import type { EngineClient } from './engine-client.js';
import { DETACH_FROM_COMPOSE, LABEL_INSTALL, LABEL_KIND } from './names.js';

const MB = 1024 * 1024;
const OUTPUT_LIMIT = 64 * 1024;

export interface IHelperMount {
  volume: string;
  target: string;
}

export interface IHelperRun {
  image: string;
  entrypoint: string[];
  cmd?: string[];
  env?: string[];
  /** The engine host's own network namespace, for the firewall tool. Default: no network. */
  network?: 'host' | 'bridge' | 'none';
  capAdd?: string[];
  /** Volumes mounted read-only. */
  mounts?: IHelperMount[];
}

export interface IHelperResult {
  exitCode: number;
  output: string;
}

/**
 * Runs one short-lived container through the engine and removes it: the only way the host touches
 * its own firewall or reads a unit's volume while stopped. Hardened like a unit.
 */
export async function runHelper(
  engine: EngineClient,
  installId: string,
  run: IHelperRun,
  timeoutMs: number,
): Promise<IHelperResult> {
  const created = await engine.json<{ Id: string }>('POST', '/containers/create', {
    body: {
      Image: run.image,
      Entrypoint: run.entrypoint,
      ...(run.cmd ? { Cmd: run.cmd } : {}),
      ...(run.env ? { Env: run.env } : {}),
      Tty: true,
      Labels: { [LABEL_INSTALL]: installId, [LABEL_KIND]: 'helper', ...DETACH_FROM_COMPOSE },
      HostConfig: {
        Privileged: false,
        CapDrop: ['ALL'],
        ...(run.capAdd ? { CapAdd: run.capAdd } : {}),
        SecurityOpt: ['no-new-privileges:true'],
        ReadonlyRootfs: true,
        NetworkMode: run.network ?? 'none',
        Memory: 128 * MB,
        MemorySwap: 128 * MB,
        PidsLimit: 64,
        RestartPolicy: { Name: 'no' },
        Mounts: (run.mounts ?? []).map((mount) => ({
          Type: 'volume',
          Source: mount.volume,
          Target: mount.target,
          ReadOnly: true,
        })),
      },
    },
  });
  const id = created.Id;
  try {
    await engine.text('POST', `/containers/${id}/start`);
    const waited = await engine.json<{ StatusCode: number }>('POST', `/containers/${id}/wait`, {
      query: { condition: 'not-running' },
      timeoutMs,
    });
    const output = await engine.text('GET', `/containers/${id}/logs`, {
      query: { stdout: '1', stderr: '1' },
    });
    return { exitCode: waited.StatusCode, output: output.slice(0, OUTPUT_LIMIT) };
  } finally {
    await engine
      .text('DELETE', `/containers/${id}`, { query: { force: '1' } })
      .catch(() => undefined);
  }
}
