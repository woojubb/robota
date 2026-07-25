/**
 * SEC-003 alert 51 — `HttpDagRuntimeProvider`'s `baseUrl` normalisation must be linear.
 *
 * `baseUrl` is a public constructor parameter, so its length is the caller's choice. The old
 * `replace(/\/+$/, '')` retried the slash run from every offset inside it: 3.0 s on a 100 K run.
 */
import { describe, expect, it } from 'vitest';

import { HttpDagRuntimeProvider } from '../http-dag-runtime-provider.js';

const PUMP = 200_000;
const BUDGET_MS = 250;
const RED_TIMEOUT_MS = 120_000;

describe('SEC-003 alert 51 — HttpDagRuntimeProvider baseUrl', () => {
  it(
    'normalises a pumped slash run in linear time',
    () => {
      const baseUrl = `http://x${'/'.repeat(PUMP)}y`;
      const started = performance.now();
      const provider = new HttpDagRuntimeProvider({ baseUrl });
      expect(performance.now() - started).toBeLessThan(BUDGET_MS);
      expect(provider.displayName).toContain('y');
    },
    RED_TIMEOUT_MS,
  );

  it('strips exactly the trailing slashes for ordinary input', () => {
    expect(new HttpDagRuntimeProvider({ baseUrl: 'http://localhost:3000///' }).displayName).toBe(
      'HTTP (http://localhost:3000)',
    );
    expect(new HttpDagRuntimeProvider({ baseUrl: 'http://localhost:3000/api' }).displayName).toBe(
      'HTTP (http://localhost:3000/api)',
    );
  });
});
