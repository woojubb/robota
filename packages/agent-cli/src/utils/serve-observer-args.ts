/**
 * Whether `--serve` also opens its read-only observer listener, decided from its flags before
 * anything starts.
 *
 * The listener binds loopback only, grants the `observe` role and nothing else, and admits by a
 * token the operator chooses, the way `--serve --http-port` takes its bearer: in the environment,
 * which the composition root clears once it is read. Nothing is minted, so the runtime never has to
 * print or write a credential to hand it to an observer. The token and the port must differ from the
 * driver listener's and the HTTP API's: a shared credential would let whoever holds the read-only
 * token drive through the other listener.
 */

import type { IParsedCliArgs } from './cli-args.js';

/** Below this a token is too easy to guess for a listener that shows a whole conversation. */
export const SERVE_OBSERVER_TOKEN_MIN_LENGTH = 32;

/** The loopback port and the token every observer presents. */
export interface IServeObserverOptions {
  readonly port: number;
  readonly token: string;
}

/** What the driver listener and the HTTP API of the same runtime already use. */
export interface IServeObserverNeighbours {
  /** The driver listener's token, when the launcher chose one. */
  readonly driverToken?: string | undefined;
  /** The driver listener's port, when the launcher chose one. */
  readonly driverPort?: number | undefined;
}

function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const port = Number.parseInt(raw, 10);
  return Number.isInteger(port) ? port : undefined;
}

/**
 * Resolves the observer listener options, or `undefined` when `--serve` names no port. Throws when
 * it cannot run. The environment is the product runtime's, where the product's own alias of each
 * variable is already folded into the canonical name; `envPrefix` is that alias prefix, so an error
 * names the variable the running product accepts.
 */
export function resolveServeObserverOptions(
  args: IParsedCliArgs,
  environment: Readonly<Record<string, string | undefined>>,
  envPrefix: string,
  neighbours: IServeObserverNeighbours = {},
): IServeObserverOptions | undefined {
  if (args.observerPort === undefined) return undefined;
  if (!args.serve) throw new Error('--observer-port is only valid with --serve');
  const token = environment['PRODUCT_OBSERVER_TOKEN'];
  const tokenName = `${envPrefix}OBSERVER_TOKEN`;
  if (token === undefined || token === '') {
    throw new Error(
      `--serve --observer-port needs ${tokenName}: the token every observer presents`,
    );
  }
  if (token.length < SERVE_OBSERVER_TOKEN_MIN_LENGTH) {
    throw new Error(`${tokenName} must be at least ${SERVE_OBSERVER_TOKEN_MIN_LENGTH} characters`);
  }
  const driverToken = neighbours.driverToken;
  const httpToken = environment['PRODUCT_HTTP_TOKEN'];
  if (token === driverToken || token === httpToken) {
    throw new Error(
      `${tokenName} must differ from the driver token and ${envPrefix}HTTP_TOKEN: a shared token would let an observer drive`,
    );
  }
  if (args.observerPort === args.httpPort || args.observerPort === neighbours.driverPort) {
    throw new Error('--observer-port must differ from --http-port and the driver listener port');
  }
  return { port: args.observerPort, token };
}

/** The driver listener port the launcher chose in the environment, as the listener itself reads it. */
export function driverListenerPort(
  environment: Readonly<Record<string, string | undefined>>,
): number | undefined {
  return parsePort(environment['PRODUCT_WS_PORT']);
}
