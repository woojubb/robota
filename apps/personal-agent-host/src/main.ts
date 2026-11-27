import { loadConfig } from './config.js';
import { HostError } from './errors.js';

const USAGE = 'Usage: personal-agent-host check-config\n';

/** Entry point of the built binary. `check-config` validates the environment and prints no secret. */
export async function main(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const [command] = argv;
  if (command !== 'check-config') {
    process.stderr.write(USAGE);
    return 2;
  }
  try {
    const config = loadConfig(env);
    const tls = config.tls.mode === 'internal' ? 'internal' : `acme (${config.tls.email})`;
    process.stdout.write(
      `Configuration is valid: ${config.baseDomain}, tls ${tls}, state ${config.stateDir}\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof HostError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
