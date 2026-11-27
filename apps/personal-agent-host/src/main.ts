import { EXIT, exitCodeFor } from './admin/protocol.js';
import { isClientCommand, runClient, USAGE } from './cli/client.js';
import { type ICliIo, processIo } from './cli/io.js';
import { loadConfig } from './config.js';
import { HostError } from './errors.js';
import { startServe } from './serve.js';

async function runServe(env: NodeJS.ProcessEnv, io: ICliIo): Promise<number> {
  const host = await startServe(env, { log: (line) => io.stderr.write(`${line}\n`) });
  const signals = io.signals ?? process;
  const signal = await new Promise<string>((resolve) => {
    signals.once('SIGTERM', () => resolve('SIGTERM'));
    signals.once('SIGINT', () => resolve('SIGINT'));
  });
  io.stderr.write(`${signal} received; shutting down\n`);
  await host.stop();
  return EXIT.ok;
}

function runCheckConfig(env: NodeJS.ProcessEnv, io: ICliIo): number {
  const config = loadConfig(env);
  const tls = config.tls.mode === 'internal' ? 'internal' : `acme (${config.tls.email})`;
  io.stdout.write(
    `Configuration is valid: ${config.baseDomain}, tls ${tls}, state ${config.stateDir}\n`,
  );
  return EXIT.ok;
}

/** Entry point of the built binary. No command prints a secret. */
export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  io: ICliIo = processIo(),
): Promise<number> {
  const [command, ...rest] = argv;
  if (isClientCommand(command)) return runClient(command, rest, env, io);
  if ((command === 'serve' || command === 'check-config') && rest.length > 0) {
    io.stderr.write(`${command} takes no arguments\n`);
    return EXIT.usage;
  }
  if (command !== 'serve' && command !== 'check-config') {
    io.stderr.write(USAGE);
    return EXIT.usage;
  }
  try {
    return command === 'serve' ? await runServe(env, io) : runCheckConfig(env, io);
  } catch (error) {
    if (error instanceof HostError) {
      io.stderr.write(`${error.message}\n`);
      return exitCodeFor(error.code);
    }
    throw error;
  }
}
