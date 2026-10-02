import { createHash, randomBytes } from 'node:crypto';
import { posix } from 'node:path';
import { productConfigEntries } from '@robota-sdk/product-config';
import { parseProductEnvironmentFile } from '@robota-sdk/product-config/node';
import { connectE2BTaskWorker } from './e2b-task-worker.js';
import { parseCliArgs } from '../utils/cli-args.js';
import { hostedSessionCheckpointBytes, projectHostedSessionCheckpoint } from './hosted-session-checkpoint.js';
import { hostedAdmissionError } from './hosted-runtime-config.js';
import { readHostedWorkerExecutionConfig } from './hosted-worker-execution-config.js';
import { openHostedServeIngress } from './hosted-serve-ingress.js';
import type { IHostedServeIngress } from './hosted-serve-ingress.js';
import type { Readable, Writable } from 'node:stream';
import type { TConfigEnvironment } from '@robota-sdk/product-config';
import type {
  IHostedRuntimeExecutor,
  THostedRuntimeExecutorFactory,
} from './hosted-runtime-types.js';
import type { IE2BWorkerProcess } from './e2b-worker-process.js';

interface ITerminalInput extends Readable {
  readonly isTTY?: boolean;
  readonly isRaw?: boolean;
  setRawMode?(mode: boolean): unknown;
}
interface ITerminalOutput extends Writable {
  readonly columns?: number;
  readonly rows?: number;
}
export interface IHostedProcessIO {
  readonly input: ITerminalInput;
  readonly output: ITerminalOutput;
  readonly error: Writable;
}

function quote(value: string): string {
  if (value.includes('\0')) throw hostedAdmissionError('worker argument contains a NUL byte');
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Stock CLI/session/tool composition executes inside the admitted task VM, never the runtime. */
export function createE2BHostedRuntimeExecutorFactory(
  environment: TConfigEnvironment,
  io: IHostedProcessIO = { input: process.stdin, output: process.stdout, error: process.stderr },
): THostedRuntimeExecutorFactory {
  return async (admission, signal, invocation): Promise<IHostedRuntimeExecutor> => {
    const config = readHostedWorkerExecutionConfig(environment, admission);
    if (invocation.mode === 'serve' && config.serve === undefined)
      throw hostedAdmissionError('serve requires an owner-selected runtime loopback ingress');
    const workerToken = invocation.mode === 'serve' ? randomBytes(32).toString('base64url') : undefined;
    const args = parseCliArgs([...invocation.argv]);
    if (invocation.resume && (config.resumeSession === undefined ||
      (args.resumeId !== undefined && args.resumeId !== config.resumeSession.id)))
      throw hostedAdmissionError('resume requires the owner-selected conversation checkpoint');
    const apiKey = environment.PRODUCT_E2B_API_KEY;
    if (typeof apiKey !== 'string' || apiKey.length === 0)
      throw hostedAdmissionError('operator E2B management capability is missing');
    const owned = await connectE2BTaskWorker({
      admission,
      signal,
      apiKey,
      templateId: config.templateId,
      allowBrokerEgress: true,
    });
    try {
      let userRoot: string | undefined;
      for (const artifact of [config.entrypoint, config.productConfig]) {
        const content = await owned.client.readFile(artifact.path);
        const limit = artifact === config.productConfig ? 65_536 : 32 * 1024 * 1024;
        if (
          Buffer.byteLength(content) > limit ||
          createHash('sha256').update(content).digest('hex') !== artifact.digest
        )
          throw hostedAdmissionError('worker template artifact does not match the pinned digest');
        if (artifact === config.productConfig) {
          const allowed = new Set(
            productConfigEntries()
              .filter((entry) => entry.descriptor.consumers.includes('cli'))
              .map((entry) => entry.descriptor.variable),
          );
          const product = parseProductEnvironmentFile(content);
          if (Object.keys(product).some((key) => !allowed.has(key)))
            throw hostedAdmissionError(
              'worker product artifact contains unsupported environment inputs',
            );
          if (product.PRODUCT_USER_STATE_DIR !== undefined)
            userRoot = posix.resolve(posix.dirname(artifact.path), product.PRODUCT_USER_STATE_DIR);
        }
      }
      const directories = await owned.client.run(
        `mkdir -p -- ${quote(posix.join(config.workspaceRoot, '.home'))} ${quote(posix.join(config.workspaceRoot, '.tmp'))}`,
        { workingDirectory: config.workspaceRoot, timeoutMs: admission.config.probeTimeoutMs },
      );
      if (directories.exitCode !== 0)
        throw hostedAdmissionError('worker private state directories are unavailable');
      if (config.resumeSession !== undefined) {
        if (userRoot === undefined || userRoot === '/' || userRoot === config.workspaceRoot || userRoot.includes('\\') ||
          (userRoot.startsWith(`${config.workspaceRoot}/`) &&
            userRoot !== posix.join(config.workspaceRoot, '.home') &&
            !userRoot.startsWith(`${posix.join(config.workspaceRoot, '.home')}/`)))
          throw hostedAdmissionError('conversation resume requires current private user state');
        const source = await owned.client.readFile(config.resumeSession.path);
        if (Buffer.byteLength(source) > 8 * 1024 * 1024 ||
          createHash('sha256').update(source).digest('hex') !== config.resumeSession.digest)
          throw hostedAdmissionError('conversation checkpoint artifact does not match its digest');
        let value: unknown;
        try { value = JSON.parse(source); } catch {
          throw hostedAdmissionError('conversation checkpoint is not valid JSON');
        }
        const record = projectHostedSessionCheckpoint(value, config.workspaceRoot);
        if (record.id !== config.resumeSession.id)
          throw hostedAdmissionError('conversation checkpoint selector does not match');
        const directory = posix.join(userRoot, 'sessions');
        const path = posix.join(directory, `${record.id}.json`);
        const prepare = await owned.client.run(
          `test ! -e ${quote(path)} && test ! -L ${quote(path)} && test ! -L ${quote(directory)} && mkdir -p -- ${quote(directory)} && chmod 700 -- ${quote(directory)}`,
          { workingDirectory: config.workspaceRoot, timeoutMs: admission.config.probeTimeoutMs },
        );
        if (prepare.exitCode !== 0)
          throw hostedAdmissionError('conversation restore cannot replace existing private state');
        const content = hostedSessionCheckpointBytes(record).toString('utf8');
        await owned.client.writeFile(path, content);
        if (await owned.client.readFile(path) !== content)
          throw hostedAdmissionError('conversation restore readback differs');
        const protect = await owned.client.run(`chmod 600 -- ${quote(path)}`,
          { workingDirectory: config.workspaceRoot, timeoutMs: admission.config.probeTimeoutMs });
        if (protect.exitCode !== 0)
          throw hostedAdmissionError('conversation restore private permissions are unavailable');
      }
      signal.throwIfAborted();
    } catch (error) {
      try {
        await owned.release();
      } catch {
        throw hostedAdmissionError('worker artifact verification failed and cleanup is unresolved');
      }
      throw error;
    }
    let remote: IE2BWorkerProcess | undefined;
    let ingress: IHostedServeIngress | undefined;
    let started = false;
    let detach = (): void => undefined;
    let stopped = false;
    const command = [
      'exec env -i',
      `PATH=${quote('/usr/local/bin:/usr/bin:/bin')}`,
      `HOME=${quote(posix.join(config.workspaceRoot, '.home'))}`,
      `TMPDIR=${quote(posix.join(config.workspaceRoot, '.tmp'))}`,
      `TERM=${quote('xterm-256color')}`,
      `PRODUCT_CONFIG_FILE=${quote(config.productConfig.path)}`,
      'PRODUCT_RUNTIME_POSTURE=local',
      ...(workerToken === undefined ? [] : [
        `PRODUCT_WS_PORT=${quote(String(config.serve!.workerPort))}`,
        'PRODUCT_WS_TOKEN="$AGENT_WORKER_WS_TOKEN"',
      ]),
      `OPENAI_BASE_URL=${quote(config.access.endpoint)}`,
      'OPENAI_API_KEY="$AGENT_TASK_BROKER_TOKEN"',
      quote(config.nodeExecutable),
      quote(config.entrypoint.path),
      ...invocation.argv.map(quote),
    ].join(' ');
    return {
      run: async (_admission, control) => {
        if (started || stopped) throw hostedAdmissionError('worker CLI execution cannot be reused');
        started = true;
        control.signal.throwIfAborted();
        signal.throwIfAborted();
        const remaining = Math.min(
          admission.config.lifetimeMs,
          config.access.expiresAt - Date.now(),
        );
        if (remaining <= 0)
          throw hostedAdmissionError('worker broker credential expired before dispatch');
        const interactive = invocation.mode === 'interactive';
        let outputBytes = 0;
        const emit = (stream: Writable, chunk: string | Uint8Array): void => {
          if (stopped || signal.aborted || control.signal.aborted) return;
          outputBytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength;
          if (outputBytes > 32 * 1024 * 1024)
            throw hostedAdmissionError('worker CLI output limit exhausted');
          stream.write(chunk);
        };
        remote = await owned.startProcess({
          command,
          cwd: config.workspaceRoot,
          environment: { AGENT_TASK_BROKER_TOKEN: config.access.token,
            ...(workerToken === undefined ? {} : { AGENT_WORKER_WS_TOKEN: workerToken }) },
          timeoutMs: remaining,
          ...(interactive
            ? { pty: { cols: io.output.columns ?? 80, rows: io.output.rows ?? 24 } }
            : {}),
          onStdout: (data) => emit(io.output, data),
          onStderr: (data) => emit(io.error, data),
        });
        signal.throwIfAborted();
        control.signal.throwIfAborted();
        if (workerToken !== undefined) {
          ingress = await openHostedServeIngress(owned, config, config.serve!, workerToken, signal, remaining);
          emit(io.output, `Hosted runtime daemon: ws://127.0.0.1:${ingress.port}/\n`);
        }
        let rejectInput!: (reason: Error) => void;
        const inputFailed = new Promise<never>((_resolve, reject) => {
          rejectInput = reject;
        });
        let pendingInput = Promise.resolve();
        const enqueue = (operation: () => Promise<void>): void => {
          pendingInput = pendingInput.then(() => {
            if (stopped || signal.aborted) return;
            return operation();
          });
          void pendingInput.catch(() =>
            rejectInput(hostedAdmissionError('worker CLI input transport failed')),
          );
        };
        const input = (data: Buffer | string): void => enqueue(() => remote!.sendInput(data));
        const end = (): void => enqueue(() => remote!.closeInput());
        const resize = (): void =>
          enqueue(() => remote!.resize(io.output.columns ?? 80, io.output.rows ?? 24));
        const inputError = (): void =>
          rejectInput(hostedAdmissionError('runtime input stream failed'));
        const wasRaw = io.input.isRaw === true;
        const wasFlowing = io.input.readableFlowing === true;
        if (interactive && io.input.isTTY) io.input.setRawMode?.(true);
        io.input.on('data', input);
        io.input.once('end', end);
        io.input.once('error', inputError);
        if (interactive) io.output.on('resize', resize);
        detach = (): void => {
          io.input.off('data', input);
          io.input.off('end', end);
          io.input.off('error', inputError);
          io.output.off('resize', resize);
          if (!wasFlowing) io.input.pause();
          if (interactive && io.input.isTTY) io.input.setRawMode?.(wasRaw);
        };
        if (io.input.readableEnded || io.input.destroyed) end();
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const expired = new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(
            () => {
              stopped = true;
              void owned.release().catch(() => undefined);
              reject(hostedAdmissionError('worker broker credential lifetime exhausted'));
            },
            Math.max(1, config.access.expiresAt - Date.now()),
          );
        });
        try {
          const exitCode = await Promise.race([remote.wait(), inputFailed, expired]);
          if (exitCode !== 0)
            throw hostedAdmissionError(`worker CLI exited with status ${exitCode}`);
        } finally {
          if (deadline !== undefined) clearTimeout(deadline);
          detach();
          await remote.disconnect();
          await ingress?.close();
        }
      },
      stop: async () => {
        stopped = true;
        detach();
        const results = await Promise.allSettled([ingress?.close(), owned.release(), remote?.disconnect()]);
        if (results.some((result) => result.status === 'rejected'))
          throw hostedAdmissionError('worker CLI resource or stream cleanup is unresolved');
      },
      release: async () => {
        const results = await Promise.allSettled([ingress?.close(), owned.release()]);
        if (results.some((result) => result.status === 'rejected'))
          throw hostedAdmissionError('worker CLI resource or serve cleanup is unresolved');
      },
    };
  };
}
