import { describe, expect, it, vi } from 'vitest';

import { takeRobotaTelemetryEnvironment } from '../live-telemetry-env.js';
import { createConfiguredNodeOtlpLiveTelemetryPort } from '../live-trace-otlp.js';

const SETTING = 'ROBOTA_TELEMETRY_PROPAGATE_TO';
const console = (extra: Record<string, string>) => ({
  ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_TRACES: 'console', ...extra,
});
const noWrite = () => undefined;

function create(env: Record<string, string | undefined>, onDiagnostic?: (message: string) => void) {
  return createConfiguredNodeOtlpLiveTelemetryPort(env, undefined, noWrite, undefined, onDiagnostic);
}

describe('ROBOTA_TELEMETRY_PROPAGATE_TO', () => {
  it('exposes the exact listed origins with trace export over console or otlp', async () => {
    const port = create(console({ [SETTING]: 'https://api.anthropic.com,http://127.0.0.1:8080,http://localhost:4000' }));
    expect(port?.traceContextPropagation?.allowedOrigins).toEqual([
      'https://api.anthropic.com', 'http://127.0.0.1:8080', 'http://localhost:4000',
    ]);
    await port?.shutdown();

    const otlp = create({
      ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_TRACES: 'otlp',
      ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf', ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'https://collector.example.com',
      [SETTING]: 'https://api.openai.com',
    });
    expect(otlp?.traceContextPropagation?.allowedOrigins).toEqual(['https://api.openai.com']);
    await otlp?.shutdown();
  });

  it('routes the diagnostic sink only when propagation is configured', async () => {
    const onDiagnostic = vi.fn();
    const port = create(console({ [SETTING]: 'https://api.anthropic.com' }), onDiagnostic);
    port?.onDiagnostic?.('provider x');
    expect(onDiagnostic).toHaveBeenCalledWith('provider x');
    await port?.shutdown();
    const plain = create(console({}), onDiagnostic);
    expect(plain?.traceContextPropagation).toBeUndefined();
    expect(plain?.onDiagnostic).toBeUndefined();
    await plain?.shutdown();
  });

  it('refuses unless telemetry is enabled with traces exported', () => {
    expect(() => create({ ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_METRICS: 'console', [SETTING]: 'https://api.anthropic.com' }))
      .toThrow(`${SETTING} is set but traces are not exported over otlp or console.`);
    expect(() => create({ ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_TRACES: 'off', ROBOTA_TELEMETRY_METRICS: 'console', [SETTING]: 'https://api.anthropic.com' }))
      .toThrow(SETTING);
  });

  it('is inert while telemetry is off', () => {
    expect(create({ [SETTING]: 'not even an origin' })).toBeUndefined();
    expect(create({ ROBOTA_TELEMETRY_ENABLED: '0', [SETTING]: 'not even an origin' })).toBeUndefined();
  });

  it.each([
    ['https://api.example.com/', 1],
    ['https://api.example.com/v1', 1],
    ['https://user:pass@api.example.com', 1],
    ['https://*.example.com', 1],
    ['*', 1],
    ['http://api.example.com', 1],
    ['https://API.example.com', 1],
    ['https://api.example.com:443', 1],
    ['https://api.example.com?x=1', 1],
    ['ftp://api.example.com', 1],
    ['', 1],
    ['https://a.example.com, https://b.example.com', 2],
    ['https://a.example.com,', 2],
  ])('refuses %j, naming only the setting and position %d', (value, position) => {
    let message = '';
    try {
      create(console({ [SETTING]: value }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(`${SETTING} has an invalid origin at position ${position}.`);
  });

  it('refuses duplicates and oversized lists without echoing values', () => {
    expect(() => create(console({ [SETTING]: 'https://a.example.com,https://a.example.com' })))
      .toThrow(`${SETTING} has a duplicate origin at position 2.`);
    const many = Array.from({ length: 17 }, (_, index) => `https://h${index}.example.com`).join(',');
    expect(() => create(console({ [SETTING]: many }))).toThrow(`${SETTING} lists too many origins.`);
    const long = `https://${'a'.repeat(300)}.example.com`;
    expect(() => create(console({ [SETTING]: long }))).toThrow(`${SETTING} has an invalid origin at position 1.`);
  });

  it('never derives propagation from ambient TRACEPARENT or OTEL_* settings', async () => {
    const port = create({
      ...console({}), TRACEPARENT: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      OTEL_PROPAGATORS: 'tracecontext', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example.com',
    });
    expect(port?.traceContextPropagation).toBeUndefined();
    await port?.shutdown();
  });

  it('is removed from the environment with the other telemetry settings', () => {
    const env: NodeJS.ProcessEnv = { [SETTING]: 'https://api.anthropic.com', PATH: '/usr/bin' };
    expect(takeRobotaTelemetryEnvironment(env)).toEqual({ [SETTING]: 'https://api.anthropic.com' });
    expect(env).toEqual({ PATH: '/usr/bin' });
  });
});
