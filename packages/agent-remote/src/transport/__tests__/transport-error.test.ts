/**
 * TransportError Tests
 *
 * Validates the structured transport error class from transport-interface.ts
 */

import { describe, it, expect } from 'vitest';
import { TransportError } from '../transport-interface';

describe('TransportError', () => {
  it('should create error with message and code', () => {
    const error = new TransportError('Connection failed', 'CONNECTION_FAILED');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(TransportError);
    expect(error.message).toBe('Connection failed');
    expect(error.code).toBe('CONNECTION_FAILED');
    expect(error.name).toBe('TransportError');
    expect(error.status).toBeUndefined();
    expect(error.details).toBeUndefined();
  });

  it('should create error with status code', () => {
    const error = new TransportError('Not Found', 'HTTP_ERROR', 404);

    expect(error.message).toBe('Not Found');
    expect(error.code).toBe('HTTP_ERROR');
    expect(error.status).toBe(404);
  });

  it('should create error with details', () => {
    const details = { statusText: 'Bad Request', status: 400 };
    const error = new TransportError('Bad Request', 'HTTP_ERROR', 400, details);

    expect(error.details).toEqual(details);
    expect(error.details?.statusText).toBe('Bad Request');
  });

  it('should be throwable and catchable', () => {
    expect(() => {
      throw new TransportError('test error', 'TEST');
    }).toThrow(TransportError);
  });

  it('should have proper prototype chain', () => {
    const error = new TransportError('test', 'TEST');

    expect(error instanceof TransportError).toBe(true);
    expect(error instanceof Error).toBe(true);
  });
});
