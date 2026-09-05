/**
 * The typed errors `TransportRegistry` raises, separated from the registry itself.
 *
 * Constructing an error with a stable `name`, a `code` and non-enumerable causes is its own job: the
 * shape is a contract consumers match on, and it changes for reasons that have nothing to do with
 * how entries are held or started. Split out when the registry reached its size limit — this is the
 * seam that was already there rather than a cut made to fit.
 */

import type {
  ITransportStartupError,
  TTransportConfigurationErrorCode,
} from '@robota-sdk/agent-interface-transport';

/** A transport that is unknown to the registry, or known and not configurable. */
export function configurationError(
  transportName: string,
  code: TTransportConfigurationErrorCode,
): Error {
  return Object.assign(new Error(`Transport ${transportName} is ${code}.`), {
    name: 'TransportConfigurationError' as const,
    code,
    transportName,
  });
}

/**
 * A transport that threw while starting, carrying what rollback did afterwards.
 *
 * `cause` and `rollbackCauses` are non-enumerable so a structured log of this error does not spill
 * the originals, while a reader who asks for them still gets them.
 */
export function startupError(
  transportName: string,
  cause: unknown,
  rollbackErrors: ITransportStartupError['rollbackErrors'],
  rollbackCauses: readonly unknown[],
): ITransportStartupError {
  const error = Object.assign(new Error(`Transport ${transportName} failed during startup.`), {
    name: 'TransportStartupError' as const,
    transportName,
    rollbackErrors: Object.freeze([...rollbackErrors]),
  });
  Object.defineProperty(error, 'cause', { value: cause, enumerable: false });
  Object.defineProperty(error, 'rollbackCauses', {
    value: Object.freeze([...rollbackCauses]),
    enumerable: false,
  });
  return error;
}
