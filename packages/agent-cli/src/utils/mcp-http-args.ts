/**
 * Which HTTP carrier `the product mcp serve` runs, decided from its flags before anything starts.
 *
 * The loopback carrier admits by a bearer the process mints and writes to a private file; that
 * bearer is only as safe as the machine boundary, so it is never offered beyond loopback. A bind to
 * any other address is accepted only together with the remote resource-server settings, whose
 * access tokens are checked against an authorization server instead. `--serve --http-port` takes the
 * same remote settings for its agent HTTP API, validated by the same function.
 */

import { isIP } from 'node:net';

import type { IMcpServeHttpOptions, IMcpServeRemoteOptions } from '../modes/mcp-serve-mode.js';
import type { IParsedCliArgs } from './cli-args.js';

const LOOPBACK = '127.0.0.1';
const REMOTE_FLAGS =
  '--http-public-url, --oauth-issuer, --oauth-scopes and --oauth-allowed-subjects';

/** Resolves the HTTP options, or `undefined` for stdio. Throws on a combination that cannot run. */
export function resolveMcpHttpOptions(
  args: IParsedCliArgs,
  mcpServe: boolean,
): IMcpServeHttpOptions | undefined {
  const remoteRequested = remoteSettingsRequested(args);
  // `--serve` takes `--http-port`, `--http-host` and the remote settings for its own agent HTTP API
  // (see serve-http-args.ts); the token file stays mcp serve's.
  const servePort = args.serve && !mcpServe;
  if (args.httpPort !== undefined && !mcpServe && !servePort) {
    throw new Error('--http-port is only valid with --serve or mcp serve HTTP mode');
  }
  if (
    (args.mcpHttpTokenFile !== undefined || (args.httpPort !== undefined && !servePort)) &&
    (!mcpServe ||
      (args.httpPort !== undefined && args.mcpHttpTokenFile === undefined && !remoteRequested))
  ) {
    throw new Error('--http-token-file and --http-port are only valid for mcp serve HTTP mode');
  }
  if (
    (remoteRequested || args.mcpHttpHost !== undefined) &&
    !mcpServe &&
    !(servePort && args.httpPort !== undefined)
  ) {
    throw new Error(
      '--http-host, --http-public-url, --oauth-* and --trusted-proxy are only valid with mcp serve or --serve --http-port',
    );
  }
  if (servePort) return undefined;
  if (!remoteRequested) {
    refuseNonLoopbackWithoutRemote(args, 'mcp serve');
    if (args.mcpHttpHost !== undefined && args.mcpHttpTokenFile === undefined) {
      throw new Error('--http-host requires --http-token-file or remote authorization');
    }
    if (args.mcpHttpTokenFile === undefined) return undefined;
    return {
      tokenFile: args.mcpHttpTokenFile,
      ...(args.httpPort !== undefined ? { port: args.httpPort } : {}),
    };
  }
  if (args.mcpHttpTokenFile !== undefined) {
    throw new Error(
      '--http-token-file is loopback-only and cannot be combined with remote authorization',
    );
  }
  return {
    ...(args.httpPort !== undefined ? { port: args.httpPort } : {}),
    remote: resolveRemoteSettings(args),
  };
}

/** Whether any remote resource-server setting was given. */
export function remoteSettingsRequested(args: IParsedCliArgs): boolean {
  return (
    args.mcpHttpPublicUrl !== undefined ||
    args.mcpOauthIssuer !== undefined ||
    args.mcpOauthScopes !== undefined ||
    args.mcpOauthAllowedSubjects !== undefined ||
    (args.mcpTrustedProxies?.length ?? 0) > 0
  );
}

/**
 * The resource-server settings, for whichever HTTP carrier asked. Throws unless they are complete,
 * the URLs are `https` and every address is a literal IP.
 */
export function resolveRemoteSettings(args: IParsedCliArgs): IMcpServeRemoteOptions {
  const publicUrl = args.mcpHttpPublicUrl;
  const issuer = args.mcpOauthIssuer;
  const scopes = args.mcpOauthScopes;
  const allowedSubjects = args.mcpOauthAllowedSubjects;
  if (
    publicUrl === undefined ||
    issuer === undefined ||
    scopes === undefined ||
    allowedSubjects === undefined
  ) {
    throw new Error(`Remote authorization requires ${REMOTE_FLAGS} together`);
  }
  if (!publicUrl.startsWith('https://')) throw new Error('--http-public-url must be an https URL');
  if (!issuer.startsWith('https://')) throw new Error('--oauth-issuer must be an https URL');
  const host = args.mcpHttpHost ?? LOOPBACK;
  if (isIP(host) === 0) throw new Error('--http-host must be a literal IP address');
  const trustedProxies = args.mcpTrustedProxies ?? [];
  if (trustedProxies.some((proxy) => isIP(proxy) === 0)) {
    throw new Error('--trusted-proxy must be a literal IP address');
  }
  return { host, publicUrl, issuer, scopes, allowedSubjects, trustedProxies };
}

/** A bind address other than loopback, refused unless the remote settings come with it. */
export function refuseNonLoopbackWithoutRemote(args: IParsedCliArgs, carrier: string): void {
  if (args.mcpHttpHost !== undefined && args.mcpHttpHost !== LOOPBACK) {
    throw new Error(`${carrier} binds a non-loopback address only with ${REMOTE_FLAGS}`);
  }
}
