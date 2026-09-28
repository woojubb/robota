import { parseCliArgs, type IParsedCliArgs } from '../utils/cli-args.js';

/**
 * The parsed arguments of a `robota mcp serve` run that will speak MCP on stdout, or `undefined`.
 * Only such a run has stdout reserved for the protocol. A help request is not one: its text must
 * reach stdout like any other help.
 */
export function mcpServeProtocolArgs(argv: readonly string[]): IParsedCliArgs | undefined {
  if (!argv.includes('mcp')) return undefined;
  try {
    const parsed = parseCliArgs([...argv]);
    return parsed.positional[0] === 'mcp' && parsed.positional[1] === 'serve' && !parsed.help
      ? parsed
      : undefined;
  } catch {
    // The normal parser reports an invalid invocation later.
    return undefined;
  }
}
