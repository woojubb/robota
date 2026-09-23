import { open, lstat, unlink } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import { buildRuntimeSession } from '@robota-sdk/agent-framework';
import { createMcpHttpHost, createMcpTransport } from '@robota-sdk/agent-transport-mcp';

import type { TInteractiveSessionOptions } from '@robota-sdk/agent-framework';
import type { Writable } from 'node:stream';

const SHUTDOWN_TIMEOUT_MS = 5000;

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

/** One product session, one MCP carrier; process signals and exit policy belong to this shell. */
export async function runMcpServeMode(
  sessionOptions: TInteractiveSessionOptions,
  version: string,
  stdout: Writable,
  http: { tokenFile?: string; port?: number } = {},
): Promise<void> {
  if (http.tokenFile !== undefined && !isAbsolute(http.tokenFile)) {
    throw new Error('MCP HTTP token file must be an absolute path');
  }
  if (http.port !== undefined && http.tokenFile === undefined) {
    throw new Error('MCP HTTP port requires a token file');
  }
  const session = buildRuntimeSession(sessionOptions);
  if (http.tokenFile !== undefined) {
    const tokenFile = http.tokenFile;
    const host = createMcpHttpHost({ name: 'robota', version, session, port: http.port });
    let createdFile: { dev: number; ino: number } | undefined;
    let onStop: (() => void) | undefined;
    const stopped = new Promise<void>((resolve) => { onStop = resolve; });
    const signal = (): void => onStop?.();
    process.once('SIGINT', signal);
    process.once('SIGTERM', signal);
    try {
      const endpoint = await Promise.race([host.start(), stopped.then(() => undefined)]);
      if (!endpoint) return;
      const file = await open(tokenFile, 'wx', 0o600);
      try {
        await file.chmod(0o600);
        const stat = await file.stat();
        createdFile = { dev: stat.dev, ino: stat.ino };
        await file.writeFile(`${endpoint.token}\n`, 'utf8');
      } finally {
        await file.close();
      }
      process.stderr.write(`MCP HTTP listening at ${endpoint.url}; bearer token file: ${tokenFile}\n`);
      await Promise.race([host.waitForClose(), stopped]);
    } finally {
      process.off('SIGINT', signal);
      process.off('SIGTERM', signal);
      try {
        await host.stop();
      } finally {
        try {
          if (createdFile) {
            const current = await lstat(tokenFile).catch((error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT') return undefined;
              throw error;
            });
            if (current?.dev === createdFile.dev && current.ino === createdFile.ino) {
              await unlink(tokenFile);
            }
          }
        } finally {
          await shutdownSession(session, 'MCP HTTP carrier closed');
        }
      }
    }
    return;
  }
  const transport = createMcpTransport({ name: 'robota', version, stdout });
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
