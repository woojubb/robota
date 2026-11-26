import { parseCliArgs, subcommandWord } from '../utils/cli-args.js';
import { isSubcommandName } from '../utils/cli-help.js';
import { validateAcpInvocation } from './acp-invocation.js';
import { validateMcpServeInvocation } from './mcp-serve-invocation.js';

import type { TProcessSurface } from '@robota-sdk/agent-local-host';

/**
 * Which process surface an invocation runs as, from its arguments alone, or `undefined` when it is
 * no surface of the secure table: a command (`usage`, `session list`, `daemon start`, `--attach`),
 * a request that runs no session (`--help`, `--version`), an invalid invocation (the parser reports
 * it later) or a run that serves (`--serve`, MCP over HTTP).
 *
 * The decision is made before the first workspace composition, which builds a session store, so it
 * reads only what the dispatch reads afterwards: a subcommand word first (a command is never a
 * surface, whatever flags follow it), then the parsed process mode. A prompt that is itself a
 * subcommand name is read as the subcommand, as the router reads it, which leaves the process
 * refused rather than given a holder it should not have.
 */
export function processSurfaceOf(
  argv: readonly string[],
  cliName: string,
): TProcessSurface | undefined {
  let args;
  try {
    args = parseCliArgs(argv.slice(2));
  } catch {
    // allow-fallback: the normal parser reports an invalid invocation later, and none is a surface.
    return undefined;
  }
  if (args.help || args.version) return undefined;
  const word = subcommandWord(args);
  try {
    if (word === 'acp') return validateAcpInvocation(args, cliName).acp ? 'acp' : undefined;
    if (word === 'mcp') {
      const { mcpServe, http } = validateMcpServeInvocation(args, cliName);
      return mcpServe && http === undefined ? 'mcp-stdio' : undefined;
    }
  } catch {
    // allow-fallback: an invocation that combines process modes is refused later, and is no surface.
    return undefined;
  }
  if (word !== undefined && isSubcommandName(word)) return undefined;
  const runsSession =
    !args.serve &&
    !args.reset &&
    !args.checkUpdate &&
    !args.configure &&
    args.configureProvider === undefined;
  return runsSession && (args.printMode || args.goal !== undefined) ? 'print' : undefined;
}
