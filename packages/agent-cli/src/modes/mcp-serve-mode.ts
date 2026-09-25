import { open, lstat, unlink } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import { buildRuntimeSession } from '@robota-sdk/agent-framework';
import { createAccessTokenVerifier } from '@robota-sdk/agent-transport/node';
import {
  createMcpHttpHost,
  createMcpRemoteHttpHost,
  createMcpTransport,
} from '@robota-sdk/agent-transport-mcp';

import type { TInteractiveSessionOptions } from '@robota-sdk/agent-framework';
import type { TAccessTokenAlgorithm } from '@robota-sdk/agent-interface-transport';
import type { IMcpRemoteAuditRecord } from '@robota-sdk/agent-transport-mcp';
import type { Writable } from 'node:stream';

const SHUTDOWN_TIMEOUT_MS = 5000;
/** Every signature algorithm the verifier supports; each is still bound to its own key shape. */
const ACCESS_TOKEN_ALGORITHMS: readonly TAccessTokenAlgorithm[] = ['RS256', 'ES256', 'EdDSA'];
const ROBOTA_SUBMIT_TOOL = {
  name: 'robota_submit',
  description: 'Robota extension: submit a prompt to the agent and await its own turn',
};

async function shutdownSession(
  session: ReturnType<typeof buildRuntimeSession>,
  message: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      session.shutdown({ reason: 'other', message }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('MCP session shutdown timed out')),
          SHUTDOWN_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Remote resource-server settings for `robota mcp serve`; the bearer file never applies here. */
export interface IMcpServeRemoteOptions {
  /** Literal IP address to bind. */
  host: string;
  publicUrl: string;
  issuer: string;
  scopes: readonly string[];
  allowedSubjects: readonly string[];
  trustedProxies: readonly string[];
}

export interface IMcpServeHttpOptions {
  tokenFile?: string;
  port?: number;
  remote?: IMcpServeRemoteOptions;
}

interface IHttpCarrier<T> {
  start(): Promise<T>;
  stop(): Promise<void>;
  waitForClose(): Promise<void>;
}

/** One cleanup path for either HTTP carrier: signal, close or failure all stop, release, shut down. */
async function serveHttpCarrier<T>(
  session: ReturnType<typeof buildRuntimeSession>,
  host: IHttpCarrier<T>,
  announce: (endpoint: T) => Promise<void>,
  release: () => Promise<void>,
): Promise<void> {
  let onStop: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => {
    onStop = resolve;
  });
  const signal = (): void => onStop?.();
  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
  try {
    const endpoint = await Promise.race([host.start(), stopped.then(() => undefined)]);
    if (!endpoint) return;
    await announce(endpoint);
    await Promise.race([host.waitForClose(), stopped]);
  } finally {
    process.off('SIGINT', signal);
    process.off('SIGTERM', signal);
    try {
      await host.stop();
    } finally {
      try {
        await release();
      } finally {
        await shutdownSession(session, 'MCP HTTP carrier closed');
      }
    }
  }
}

function auditToStderr(record: IMcpRemoteAuditRecord): void {
  process.stderr.write(
    `MCP HTTP refused: ${record.refusal} (${record.remote}${record.throttled ? ', throttled' : ''})\n`,
  );
}

/** One product session, one MCP carrier; process signals and exit policy belong to this shell. */
export async function runMcpServeMode(
  sessionOptions: TInteractiveSessionOptions,
  version: string,
  stdout: Writable,
  http: IMcpServeHttpOptions = {},
): Promise<void> {
  if (http.remote !== undefined) {
    if (http.tokenFile !== undefined) {
      throw new Error('MCP HTTP token file is not accepted with remote authorization');
    }
    const remote = http.remote;
    const verifier = createAccessTokenVerifier({
      issuer: remote.issuer,
      resource: remote.publicUrl,
      algorithms: ACCESS_TOKEN_ALGORITHMS,
      requiredScopes: remote.scopes,
      allowedSubjects: remote.allowedSubjects,
    });
    const session = buildRuntimeSession(sessionOptions);
    let host: ReturnType<typeof createMcpRemoteHttpHost>;
    try {
      host = createMcpRemoteHttpHost({
        name: 'robota',
        version,
        session,
        host: remote.host,
        port: http.port,
        submitTool: ROBOTA_SUBMIT_TOOL,
        authorization: {
          publicUrl: remote.publicUrl,
          issuer: remote.issuer,
          scopes: remote.scopes,
          verifier,
          trustedProxies: remote.trustedProxies,
          audit: auditToStderr,
        },
      });
    } catch (error) {
      await shutdownSession(session, 'MCP HTTP carrier refused its configuration');
      throw error;
    }
    return serveHttpCarrier(
      session,
      host,
      async (endpoint) => {
        process.stderr.write(
          `MCP HTTP listening on ${endpoint.listening} for ${endpoint.url}; authorization server: ${remote.issuer}\n`,
        );
      },
      async () => undefined,
    );
  }
  if (http.tokenFile !== undefined && !isAbsolute(http.tokenFile)) {
    throw new Error('MCP HTTP token file must be an absolute path');
  }
  if (http.port !== undefined && http.tokenFile === undefined) {
    throw new Error('MCP HTTP port requires a token file');
  }
  const session = buildRuntimeSession(sessionOptions);
  if (http.tokenFile !== undefined) {
    const tokenFile = http.tokenFile;
    const host = createMcpHttpHost({
      name: 'robota',
      version,
      session,
      port: http.port,
      submitTool: ROBOTA_SUBMIT_TOOL,
    });
    let createdFile: { dev: number; ino: number } | undefined;
    await serveHttpCarrier(
      session,
      host,
      async (endpoint) => {
        const file = await open(tokenFile, 'wx', 0o600);
        try {
          await file.chmod(0o600);
          const stat = await file.stat();
          createdFile = { dev: stat.dev, ino: stat.ino };
          await file.writeFile(`${endpoint.token}\n`, 'utf8');
        } finally {
          await file.close();
        }
        process.stderr.write(
          `MCP HTTP listening at ${endpoint.url}; bearer token file: ${tokenFile}\n`,
        );
      },
      async () => {
        if (!createdFile) return;
        const current = await lstat(tokenFile).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return undefined;
          throw error;
        });
        if (current?.dev === createdFile.dev && current.ino === createdFile.ino) {
          await unlink(tokenFile);
        }
      },
    );
    return;
  }
  const transport = createMcpTransport({
    name: 'robota',
    version,
    stdout,
    submitTool: ROBOTA_SUBMIT_TOOL,
  });
  transport.attach(session);
  let onStop: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => {
    onStop = resolve;
  });
  const signal = (): void => onStop?.();
  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
  try {
    // A signal or peer close during async catalog validation must reach teardown immediately.
    // The transport's stop() cancels the pending startup rather than waiting for it.
    await Promise.race([transport.start(), transport.waitForClose(), stopped]);
    await Promise.race([transport.waitForClose(), stopped]);
  } finally {
    process.off('SIGINT', signal);
    process.off('SIGTERM', signal);
    try {
      await transport.stop();
    } finally {
      await shutdownSession(session, 'MCP stdio carrier closed');
    }
  }
}
