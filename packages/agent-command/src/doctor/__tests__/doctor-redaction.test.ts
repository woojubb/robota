import { describe, expect, it } from 'vitest';

import { redactDiagnosticText } from '../doctor-redaction.js';

describe('doctor redaction', () => {
  it('still masks URL userinfo', () => {
    expect(redactDiagnosticText('see https://user:hunter22@example.com/x')).toBe(
      'see https://[redacted]@example.com/x',
    );
  });

  it('stays linear on long word runs that never reach a URL scheme', () => {
    const timeFor = (n: number): number => {
      const text = `x-${'a-'.repeat(n / 2)}`;
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < 3; i += 1) {
        const started = performance.now();
        redactDiagnosticText(text);
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    const small = timeFor(16 * 1024);
    const large = timeFor(64 * 1024);
    // Linear growth is about 4x for 4x input; the old unbounded scheme run grew about 16x.
    if (large >= 50) expect(large / Math.max(small, 1)).toBeLessThan(10);
    expect(large).toBeLessThan(500);
  });
});
