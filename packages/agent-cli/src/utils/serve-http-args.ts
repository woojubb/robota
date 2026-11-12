/**
 * Whether `--serve` also serves the agent's HTTP API, decided from its flags before anything starts.
 *
 * The API binds loopback only and admits by a bearer the operator chooses: a server's clients must
 * keep working across restarts, so the per-launch token `mcp serve` mints into a file does not fit,
 * and the bearer arrives the way `--serve` already takes its WebSocket token — in the environment,
 * which the composition root clears once it is read. A bearer is only as safe as the machine
 * boundary, so it is never offered beyond loopback: any other address is bound only as an OAuth
 * resource server, with the same remote settings `mcp serve` takes, and then no bearer is accepted.
 */

import {
  refuseNonLoopbackWithoutRemote,
  remoteSettingsRequested,
  resolveRemoteSettings,
} from './mcp-http-args.js';

import type { IMcpServeRemoteOptions } from '../modes/mcp-serve-mode.js';
import type { IParsedCliArgs } from './cli-args.js';

/** Below this a bearer is too easy to guess for an API that can run tools. */
export const SERVE_HTTP_TOKEN_MIN_LENGTH = 32;

/** Loopback with the operator's bearer, or an OAuth resource server — never both. */
export type IServeHttpOptions =
  | { readonly port: number; readonly token: string; readonly remote?: undefined }
  | { readonly port: number; readonly remote: IMcpServeRemoteOptions; readonly token?: undefined };

/**
 * Resolves the HTTP API options, or `undefined` when `--serve` names no port. Throws when it cannot
 * run. The environment is the product runtime's, where the product's own alias of the variable is
 * already folded into the canonical name; `envPrefix` is that alias prefix, so an error names the
 * variable the running product accepts.
 */
export function resolveServeHttpOptions(
  args: IParsedCliArgs,
  environment: Readonly<Record<string, string | undefined>>,
  envPrefix: string,
): IServeHttpOptions | undefined {
  if (!args.serve || args.httpPort === undefined) return undefined;
  const token = environment['PRODUCT_HTTP_TOKEN'];
  const tokenName = `${envPrefix}HTTP_TOKEN`;
  if (remoteSettingsRequested(args)) {
    if (token !== undefined && token !== '') {
      throw new Error(
        `${tokenName} is loopback-only and cannot be combined with remote authorization`,
      );
    }
    return { port: args.httpPort, remote: resolveRemoteSettings(args) };
  }
  refuseNonLoopbackWithoutRemote(args, '--serve --http-port');
  if (token === undefined || token === '') {
    throw new Error(
      `--serve --http-port needs ${tokenName}: the bearer every HTTP client presents`,
    );
  }
  if (token.length < SERVE_HTTP_TOKEN_MIN_LENGTH) {
    throw new Error(`${tokenName} must be at least ${SERVE_HTTP_TOKEN_MIN_LENGTH} characters`);
  }
  return { port: args.httpPort, token };
}
