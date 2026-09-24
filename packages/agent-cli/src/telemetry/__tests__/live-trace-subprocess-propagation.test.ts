import { describe, expect, it, vi } from 'vitest';

import { takeRobotaTelemetryEnvironment } from '../live-telemetry-env.js';
import { createConfiguredNodeOtlpLiveTelemetryPort } from '../live-trace-otlp.js';

const SETTING = 'ROBOTA_TELEMETRY_PROPAGATE_TO_SUBPROCESSES';
const ORIGINS = 'ROBOTA_TELEMETRY_PROPAGATE_TO';
const console = (extra: Record<string, string>) => ({
  ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_TRACES: 'console', ...extra,
});
const noWrite = () => undefined;

function create(env: Record<string, string | undefined>, onDiagnostic?: (message: string) => void) {
  return createConfiguredNodeOtlpLiveTelemetryPort(env, undefined, noWrite, undefined, onDiagnostic);
}

describe('ROBOTA_TELEMETRY_PROPAGATE_TO_SUBPROCESSES', () => {
  it.each([
    ['shell', ['shell']],
    ['hooks', ['hooks']],
    ['shell,hooks', ['shell', 'hooks']],
    ['hooks,shell', ['hooks', 'shell']],
  ])('accepts %j without any origin', async (value, classes) => {
    const port = create(console({ [SETTING]: value }));
    expect(port?.traceContextPropagation).toEqual({ allowedOrigins: [], subprocesses: classes });
    await port?.shutdown();
  });

  it('combines with listed origins and works over otlp', async () => {
    const port = create({
      ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_TRACES: 'otlp',
      ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf', ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'https://collector.example.com',
      [ORIGINS]: 'https://api.anthropic.com', [SETTING]: 'shell',
    });
    expect(port?.traceContextPropagation).toEqual({
      allowedOrigins: ['https://api.anthropic.com'], subprocesses: ['shell'],
    });
    await port?.shutdown();
  });

  it('leaves origin-only propagation without subprocess classes', async () => {
    const port = create(console({ [ORIGINS]: 'https://api.anthropic.com' }));
    expect(port?.traceContextPropagation).toEqual({ allowedOrigins: ['https://api.anthropic.com'] });
    await port?.shutdown();
  });

  it('routes the diagnostic sink when only subprocess classes are set', async () => {
    const onDiagnostic = vi.fn();
    const port = create(console({ [SETTING]: 'hooks' }), onDiagnostic);
    expect(port?.onDiagnostic).toBeDefined();
    await port?.shutdown();
  });

  it('refuses unless telemetry is enabled with traces exported', () => {
    expect(() => create({ ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_METRICS: 'console', [SETTING]: 'shell' }))
      .toThrow(`${SETTING} is set but traces are not exported over otlp or console.`);
    expect(() => create({ ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_TRACES: 'off', ROBOTA_TELEMETRY_METRICS: 'console', [SETTING]: 'shell' }))
      .toThrow(`${SETTING} is set but traces are not exported over otlp or console.`);
  });

  it('is inert while telemetry is off', () => {
    expect(create({ [SETTING]: 'not a class' })).toBeUndefined();
    expect(create({ ROBOTA_TELEMETRY_ENABLED: '0', [SETTING]: 'not a class' })).toBeUndefined();
  });

  it.each([
    ['', 1],
    ['Shell', 1],
    [' shell', 1],
    ['mcp', 1],
    ['shell,', 2],
    ['shell,shell', 2],
    ['hooks, shell', 2],
    ['shell,hooks,background', 3],
  ])('refuses %j, naming only the setting and position %d', (value, position) => {
    let message = '';
    try {
      create(console({ [SETTING]: value }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(`${SETTING} has an invalid entry at position ${position}.`);
  });

  it('is removed from the environment with the other telemetry settings', () => {
    const env: NodeJS.ProcessEnv = { [SETTING]: 'shell', PATH: '/usr/bin' };
    expect(takeRobotaTelemetryEnvironment(env)).toEqual({ [SETTING]: 'shell' });
    expect(env).toEqual({ PATH: '/usr/bin' });
  });
});
