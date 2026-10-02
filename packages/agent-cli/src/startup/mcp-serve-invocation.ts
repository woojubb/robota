import { parseCliArgs, subcommandWord, type IParsedCliArgs } from '../utils/cli-args.js';
import { resolveMcpHttpOptions } from '../utils/mcp-http-args.js';
import type { IMcpServeHttpOptions } from '../modes/mcp-serve-mode.js';

/** Pure process-mode validation shared by local and hosted execution before any carrier starts. */
export function validateMcpServeInvocation(
  args: IParsedCliArgs,
  cliName: string,
): { mcpServe: boolean; http: IMcpServeHttpOptions | undefined } {
  const subcommand = subcommandWord(args);
  const mcpServe = subcommand === 'mcp' && args.positional[1] === 'serve';
  if (subcommand === 'mcp' && (!mcpServe || args.positional.length !== 2)) {
    throw new Error(`Usage: ${cliName} mcp serve [options]`);
  }
  const http = resolveMcpHttpOptions(args, mcpServe);
  if (
    mcpServe &&
    (args.serve ||
      args.printMode ||
      args.goal !== undefined ||
      args.open ||
      args.configure ||
      args.configureProvider !== undefined ||
      args.reset)
  ) {
    throw new Error(
      `${cliName} mcp serve cannot be combined with another process mode or setup command`,
    );
  }
  return { mcpServe, http };
}

/**
 * The parsed arguments of a `the product mcp serve` run that will speak MCP on stdout, or `undefined`.
 * Only such a run has stdout reserved for the protocol. A help request is not one: its text must
 * reach stdout like any other help.
 */
export function mcpServeProtocolArgs(argv: readonly string[]): IParsedCliArgs | undefined {
  if (!argv.includes('mcp')) return undefined;
  try {
    const parsed = parseCliArgs([...argv]);
    return subcommandWord(parsed) === 'mcp' && parsed.positional[1] === 'serve' && !parsed.help
      ? parsed
      : undefined;
  } catch {
    // The normal parser reports an invalid invocation later.
    return undefined;
  }
}
