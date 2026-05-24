import { describe, it, expect } from 'vitest';

import { classifyFetchError } from '../builtins/web-fetch-tool.js';

function makeNodeError(code: string): Error {
  const err = new Error(`${code} error`);
  (err as NodeJS.ErrnoException).code = code;
  return err;
}

describe('classifyFetchError', () => {
  it('returns string representation for non-Error value', () => {
    expect(classifyFetchError('something')).toBe('something');
    expect(classifyFetchError(42)).toBe('42');
  });

  it('returns timeout message for AbortError', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    const msg = classifyFetchError(err);
    expect(msg).toMatch(/timed out/);
  });

  it('returns DNS error message for ENOTFOUND', () => {
    const msg = classifyFetchError(makeNodeError('ENOTFOUND'));
    expect(msg).toMatch(/DNS resolution failed/);
  });

  it('returns DNS error message for EAI_AGAIN', () => {
    const msg = classifyFetchError(makeNodeError('EAI_AGAIN'));
    expect(msg).toMatch(/DNS resolution failed/);
  });

  it('returns connection refused message for ECONNREFUSED', () => {
    const msg = classifyFetchError(makeNodeError('ECONNREFUSED'));
    expect(msg).toMatch(/Connection refused/);
  });

  it('returns connection reset message for ECONNRESET', () => {
    const msg = classifyFetchError(makeNodeError('ECONNRESET'));
    expect(msg).toMatch(/Connection was reset/);
  });

  it('returns timeout message for ETIMEDOUT', () => {
    const msg = classifyFetchError(makeNodeError('ETIMEDOUT'));
    expect(msg).toMatch(/Connection timed out/);
  });

  it('returns SSL error message for CERT_HAS_EXPIRED', () => {
    const msg = classifyFetchError(makeNodeError('CERT_HAS_EXPIRED'));
    expect(msg).toMatch(/SSL certificate error/);
  });

  it('returns generic network error for unknown code', () => {
    const msg = classifyFetchError(makeNodeError('EUNKNOWN'));
    expect(msg).toMatch(/Network error/);
  });

  it('returns generic message for plain Error with no code', () => {
    const msg = classifyFetchError(new Error('something went wrong'));
    expect(msg).toMatch(/Network error/);
  });
});
