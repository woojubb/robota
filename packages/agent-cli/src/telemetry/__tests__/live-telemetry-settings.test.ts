import { describe, expect, it } from 'vitest';
import { createConfiguredNodeOtlpLiveTelemetryPort } from '../live-trace-otlp.js';

const base = {
  ROBOTA_TELEMETRY_ENABLED: '1',
  ROBOTA_TELEMETRY_TRACES: 'otlp',
  ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
  ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
};

describe('Robota live telemetry settings', () => {
  it.each([
    ['ROBOTA_TELEMETRY_OTLP_HEADERS_HELPER', /headers are not supported/u],
    ['ROBOTA_TELEMETRY_OTLP_HEADERS_REFRESH', /headers are not supported/u],
    ['ROBOTA_TELEMETRY_HEADERS', /headers are not supported/u],
    ['ROBOTA_TELEMETRY_OTLP_CLIENT_CERTIFICATE', /client certificates and custom CAs are not supported/u],
    ['ROBOTA_TELEMETRY_OTLP_CLIENT_KEY', /client certificates and custom CAs are not supported/u],
    ['ROBOTA_TELEMETRY_OTLP_CERTIFICATE', /client certificates and custom CAs are not supported/u],
    ['ROBOTA_TELEMETRY_LOCKED_DESTINATION', /managed destination lock cannot be enforced/u],
    ['ROBOTA_TELEMETRY_LOG_USER_PROMPTS', /content capture is not supported/u],
    ['ROBOTA_TELEMETRY_TOOL_CONTENT', /content capture is not supported/u],
    ['ROBOTA_TELEMETRY_SAMPLE_RATE', /Unknown Robota telemetry setting ROBOTA_TELEMETRY_SAMPLE_RATE/u],
  ])('refuses to start when %s is supplied, naming it but never echoing its value', (name, message) => {
    const secret = 'Bearer s3cr3t-value';
    let error: unknown;
    try { createConfiguredNodeOtlpLiveTelemetryPort({ ...base, [name]: secret }); }
    catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(message);
    expect((error as Error).message).not.toContain(secret);
  });

  it('refuses unsupported settings even for console-only telemetry', () => {
    expect(() => createConfiguredNodeOtlpLiveTelemetryPort({
      ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_LOGS: 'console',
      ROBOTA_TELEMETRY_OTLP_HEADERS_HELPER: 'x',
    }, undefined, () => undefined)).toThrow(/headers are not supported/u);
  });

  it('keeps disabled telemetry inert whatever else is set', () => {
    expect(createConfiguredNodeOtlpLiveTelemetryPort({
      ROBOTA_TELEMETRY_OTLP_HEADERS: 'x', ROBOTA_TELEMETRY_SAMPLE_RATE: '1',
    })).toBeUndefined();
    expect(createConfiguredNodeOtlpLiveTelemetryPort({
      ROBOTA_TELEMETRY_ENABLED: '0', ROBOTA_TELEMETRY_OTLP_HEADERS: 'x',
    })).toBeUndefined();
  });

  it('accepts every supported setting together', async () => {
    const port = createConfiguredNodeOtlpLiveTelemetryPort({
      ...base,
      ROBOTA_TELEMETRY_METRICS: 'console',
      ROBOTA_TELEMETRY_LOGS: 'off',
      ROBOTA_TELEMETRY_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:4318/v1/traces',
      ROBOTA_TELEMETRY_OTLP_METRICS_ENDPOINT: 'http://127.0.0.1:4318/v1/metrics',
      ROBOTA_TELEMETRY_OTLP_LOGS_ENDPOINT: 'http://127.0.0.1:4318/v1/logs',
      ROBOTA_TELEMETRY_OTLP_TRACES_HEADERS: 'authorization=Bearer%20t',
      ROBOTA_TELEMETRY_METRIC_ATTRIBUTES: 'session,provider,model',
    }, undefined, () => undefined);
    expect(port).toBeDefined();
    await port?.shutdown();
  });
});
