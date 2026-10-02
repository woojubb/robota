import { describe, expect, it } from 'vitest';

import { takeProductTelemetryEnvironment } from '../live-telemetry-env.js';

const SENTINEL = 'Authorization=Bearer%20sentinel-strip-k4';

describe('product telemetry environment snapshots', () => {
  it('copies only canonical telemetry values without mutating the source environment', () => {
    const env: Record<string, string | undefined> = {
      PRODUCT_TELEMETRY_ENABLED: '1',
      PRODUCT_TELEMETRY_OTLP_HEADERS: SENTINEL,
      PRODUCT_TELEMETRY_SOMETHING_UNKNOWN: 'x',
      PRODUCT_TELEMETRY_UNDEFINED: undefined,
      CEDAR_TELEMETRY_OTLP_ENDPOINT: 'https://alias.example',
      OTHER_SETTING: 'kept',
      PATH: '/usr/bin',
    };
    const before = { ...env };

    const snapshot = takeProductTelemetryEnvironment(env);

    expect(snapshot).toEqual({
      PRODUCT_TELEMETRY_ENABLED: '1',
      PRODUCT_TELEMETRY_OTLP_HEADERS: SENTINEL,
      PRODUCT_TELEMETRY_SOMETHING_UNKNOWN: 'x',
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(env).toEqual(before);
  });

  it('does not reuse or mix snapshots across A, B, empty, and A invocations', () => {
    const a = {
      PRODUCT_TELEMETRY_ENABLED: '1',
      PRODUCT_TELEMETRY_OTLP_ENDPOINT: 'https://collector-a.example',
      PRODUCT_TELEMETRY_OTLP_HEADERS: 'authorization=Bearer%20a-only',
    };
    const b = {
      PRODUCT_TELEMETRY_ENABLED: '1',
      PRODUCT_TELEMETRY_OTLP_ENDPOINT: 'https://collector-b.example',
    };

    const firstA = takeProductTelemetryEnvironment(a);
    const snapshotB = takeProductTelemetryEnvironment(b);
    const empty = takeProductTelemetryEnvironment({ PATH: '/usr/bin' });
    const secondA = takeProductTelemetryEnvironment(a);

    expect(firstA).toMatchObject({ PRODUCT_TELEMETRY_OTLP_ENDPOINT: 'https://collector-a.example' });
    expect(snapshotB).toEqual(b);
    expect(snapshotB).not.toHaveProperty('PRODUCT_TELEMETRY_OTLP_HEADERS');
    expect(empty).toEqual({});
    expect(secondA).toEqual(firstA);
    expect(secondA).not.toBe(firstA);
    expect(a).toEqual({
      PRODUCT_TELEMETRY_ENABLED: '1',
      PRODUCT_TELEMETRY_OTLP_ENDPOINT: 'https://collector-a.example',
      PRODUCT_TELEMETRY_OTLP_HEADERS: 'authorization=Bearer%20a-only',
    });
  });
});
