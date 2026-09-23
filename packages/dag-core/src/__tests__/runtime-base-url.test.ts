import { describe, expect, it } from 'vitest';
import { DEFAULT_DAG_RUNTIME_BASE_URL, resolveRuntimeBaseUrl } from '../types/node-lifecycle.js';

describe('resolveRuntimeBaseUrl', () => {
  it('uses the runtime-provided URL and removes a trailing slash', () => {
    expect(resolveRuntimeBaseUrl({ runtimeBaseUrl: 'https://runtime.test/' })).toBe(
      'https://runtime.test',
    );
  });

  it('uses the stable loopback default when the run provides no URL', () => {
    expect(resolveRuntimeBaseUrl({})).toBe(DEFAULT_DAG_RUNTIME_BASE_URL);
    expect(resolveRuntimeBaseUrl({ runtimeBaseUrl: '   ' })).toBe(DEFAULT_DAG_RUNTIME_BASE_URL);
  });
});
