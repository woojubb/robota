/**
 * A busy observer port is the failure an operator meets, and the registry's startup error keeps its
 * cause out of the message: the start names the port and the cause for that listener and leaves
 * every other failure as it was.
 */
import { describe, expect, it } from 'vitest';

import { observerStartFailure } from '../serve-mode.js';

const observer = { configuredPort: 7171, boundPort: () => undefined };

function startupError(transportName: string, cause: unknown): Error {
  const error = Object.assign(new Error(`Transport ${transportName} failed during startup.`), {
    name: 'TransportStartupError',
    transportName,
  });
  Object.defineProperty(error, 'cause', { value: cause, enumerable: false });
  return error;
}

describe('the failure of an observer listener start', () => {
  it('names the port and the cause when the observer listener could not start', () => {
    const failure = observerStartFailure(
      startupError(
        'ws-observer',
        new Error('listen EADDRINUSE: address already in use 127.0.0.1:7171'),
      ),
      observer,
    );
    expect(failure?.message).toBe(
      'Observer listener could not be served on 127.0.0.1:7171: listen EADDRINUSE: address already in use 127.0.0.1:7171',
    );
  });

  it('leaves a failure of any other transport as it was', () => {
    expect(observerStartFailure(startupError('ws', new Error('boom')), observer)).toBeUndefined();
  });

  it('leaves every failure alone when no observer was asked for', () => {
    expect(
      observerStartFailure(startupError('ws-observer', new Error('boom')), undefined),
    ).toBeUndefined();
  });

  it('leaves an error that is not a transport startup error alone', () => {
    expect(observerStartFailure(new Error('boom'), observer)).toBeUndefined();
    expect(observerStartFailure('boom', observer)).toBeUndefined();
  });
});
