import { describe, expect, it } from 'vitest';

import { nameAcceptedTelemetryVariables } from '../live-telemetry-env.js';
import {
  createConfiguredNodeOtlpLiveTelemetryPort,
  validateNodeOtlpLiveTelemetrySettings,
} from '../live-trace-otlp.js';

import type { ILiveTelemetryHostResource } from '../live-resource.js';

/** The running product's own alias prefix: the name a refusal must give, not the canonical one. */
const ENV_PREFIX = 'CEDAR_';

const host = (envPrefix?: string): ILiveTelemetryHostResource => ({
  telemetryServiceName: 'cedar.agent',
  serviceVersion: '1.0.0',
  surface: 'interactive',
  ...(envPrefix === undefined ? {} : { envPrefix }),
});

const redaction = { getSecrets: () => [], cwd: '/nonexistent', homedir: '/home/al' };

const exportingTraces = {
  PRODUCT_TELEMETRY_ENABLED: '1',
  PRODUCT_TELEMETRY_TRACES: 'otlp',
  PRODUCT_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
  PRODUCT_TELEMETRY_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
};

/** Every refusal that names a setting, with the message the running product must print for it. */
const REFUSALS: readonly [string, Record<string, string>, string][] = [
  [
    'metric attributes while metrics are not exported',
    { ...exportingTraces, PRODUCT_TELEMETRY_METRIC_ATTRIBUTES: 'session' },
    'CEDAR_TELEMETRY_METRIC_ATTRIBUTES is set but metrics are not exported over otlp or console.',
  ],
  [
    'a malformed metric attribute token',
    {
      ...exportingTraces,
      PRODUCT_TELEMETRY_METRICS: 'console',
      PRODUCT_TELEMETRY_METRIC_ATTRIBUTES: 'nope',
    },
    'CEDAR_TELEMETRY_METRIC_ATTRIBUTES has an invalid token at position 1.',
  ],
  [
    'an unsupported semantic convention',
    { ...exportingTraces, PRODUCT_TELEMETRY_SEMCONV: 'nope' },
    'CEDAR_TELEMETRY_SEMCONV has an unsupported value.',
  ],
  [
    'a semantic convention while nothing is exported',
    { PRODUCT_TELEMETRY_ENABLED: '1', PRODUCT_TELEMETRY_SEMCONV: 'gen_ai' },
    'CEDAR_TELEMETRY_SEMCONV is set but neither traces nor metrics are exported over otlp or console.',
  ],
  [
    'propagation origins while traces are not exported',
    { PRODUCT_TELEMETRY_ENABLED: '1', PRODUCT_TELEMETRY_PROPAGATE_TO: 'https://a.example' },
    'CEDAR_TELEMETRY_PROPAGATE_TO is set but traces are not exported over otlp or console.',
  ],
  [
    'a malformed propagation origin',
    { ...exportingTraces, PRODUCT_TELEMETRY_PROPAGATE_TO: 'a.example' },
    'CEDAR_TELEMETRY_PROPAGATE_TO has an invalid origin at position 1.',
  ],
  [
    'a malformed subprocess class',
    { ...exportingTraces, PRODUCT_TELEMETRY_PROPAGATE_TO_SUBPROCESSES: 'nope' },
    'CEDAR_TELEMETRY_PROPAGATE_TO_SUBPROCESSES has an invalid entry at position 1.',
  ],
  [
    'an unknown setting',
    { ...exportingTraces, PRODUCT_TELEMETRY_SAMPLE_RATE: '1' },
    'Unknown Product telemetry setting CEDAR_TELEMETRY_SAMPLE_RATE.',
  ],
  [
    'an unsupported header setting',
    { ...exportingTraces, PRODUCT_TELEMETRY_OTLP_HEADERS_HELPER: 'x' },
    'Product telemetry headers are not supported (CEDAR_TELEMETRY_OTLP_HEADERS_HELPER); refusing to export without them.',
  ],
  [
    'a malformed header setting',
    { ...exportingTraces, PRODUCT_TELEMETRY_OTLP_HEADERS: 'broken' },
    'Invalid Product telemetry header setting CEDAR_TELEMETRY_OTLP_HEADERS (entry 1).',
  ],
  [
    'generic headers that no signal uses',
    {
      ...exportingTraces,
      PRODUCT_TELEMETRY_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:4318/v1/traces',
      PRODUCT_TELEMETRY_OTLP_HEADERS: 'authorization=a',
    },
    'CEDAR_TELEMETRY_OTLP_HEADERS is set but no OTLP signal uses CEDAR_TELEMETRY_OTLP_ENDPOINT.',
  ],
  [
    'headers for a signal that does not export',
    { ...exportingTraces, PRODUCT_TELEMETRY_OTLP_METRICS_HEADERS: 'authorization=a' },
    'CEDAR_TELEMETRY_OTLP_METRICS_HEADERS is set but that signal does not export over OTLP.',
  ],
  [
    'content capture without OTLP logs',
    { PRODUCT_TELEMETRY_ENABLED: '1', PRODUCT_TELEMETRY_LOG_USER_PROMPTS: '1' },
    'Product telemetry content capture requires CEDAR_TELEMETRY_LOGS=otlp.',
  ],
  [
    'a content gate that is neither 0 nor 1',
    { PRODUCT_TELEMETRY_ENABLED: '1', PRODUCT_TELEMETRY_LOG_USER_PROMPTS: 'yes' },
    'CEDAR_TELEMETRY_LOG_USER_PROMPTS must be exactly 0 or 1.',
  ],
  [
    'a content size limit without a content gate',
    { PRODUCT_TELEMETRY_ENABLED: '1', PRODUCT_TELEMETRY_LOG_CONTENT_MAX_BYTES: '512' },
    'CEDAR_TELEMETRY_LOG_CONTENT_MAX_BYTES is set but no content capture setting is 1.',
  ],
];

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return (error as Error).message;
  }
  throw new Error('expected the telemetry settings to be refused');
}

describe('telemetry refusals name the variables the running product accepts', () => {
  describe.each([
    [
      'validated before a child is spawned',
      (env: Record<string, string>, resource: ILiveTelemetryHostResource) => () =>
        validateNodeOtlpLiveTelemetrySettings(env, resource),
    ],
    [
      'resolved when the runtime starts',
      (env: Record<string, string>, resource: ILiveTelemetryHostResource) => () =>
        createConfiguredNodeOtlpLiveTelemetryPort(
          env,
          undefined,
          () => undefined,
          resource,
          undefined,
          redaction,
        ),
    ],
  ])('settings %s', (_label, run) => {
    it.each(REFUSALS)('%s', (_name, env, expected) => {
      const message = messageOf(run(env, host(ENV_PREFIX)));
      expect(message).toBe(expected);
      expect(message).not.toMatch(/\bPRODUCT_/u);
    });

    it('names the stock product by its own prefix', () => {
      const message = messageOf(
        run(
          { PRODUCT_TELEMETRY_ENABLED: '1', PRODUCT_TELEMETRY_LOG_USER_PROMPTS: '1' },
          host('ROBOTA_'),
        ),
      );
      expect(message).toBe(
        'Product telemetry content capture requires ROBOTA_TELEMETRY_LOGS=otlp.',
      );
    });

    it('keeps the canonical names for a caller that has no product identity', () => {
      const message = messageOf(
        run({ PRODUCT_TELEMETRY_ENABLED: '1', PRODUCT_TELEMETRY_LOG_USER_PROMPTS: '1' }, host()),
      );
      expect(message).toBe(
        'Product telemetry content capture requires PRODUCT_TELEMETRY_LOGS=otlp.',
      );
    });
  });
});

describe('nameAcceptedTelemetryVariables', () => {
  it('replaces every canonical occurrence and leaves the rest of the message alone', () => {
    const message = messageOf(() =>
      nameAcceptedTelemetryVariables(ENV_PREFIX, () => {
        throw new Error('PRODUCT_TELEMETRY_A conflicts with PRODUCT_TELEMETRY_B ($& PRODUCT_ID).');
      }),
    );
    expect(message).toBe('CEDAR_TELEMETRY_A conflicts with CEDAR_TELEMETRY_B ($& PRODUCT_ID).');
  });

  it('returns what the resolver returns', () => {
    expect(nameAcceptedTelemetryVariables(ENV_PREFIX, () => 'resolved')).toBe('resolved');
  });

  it('rethrows a value that is not an Error unchanged', () => {
    const thrown = { reason: 'PRODUCT_TELEMETRY_A' };
    let caught: unknown;
    try {
      nameAcceptedTelemetryVariables(ENV_PREFIX, () => {
        throw thrown;
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(thrown);
  });
});
