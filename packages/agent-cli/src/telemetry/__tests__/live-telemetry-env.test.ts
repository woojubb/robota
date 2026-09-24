import { afterEach, describe, expect, it, vi } from 'vitest';

import { startCliCore } from '../../cli-core.js';
import { applyLaunchInvocation } from '../../launch-intent/open-invocation-host.js';
import { takeRobotaTelemetryEnvironment } from '../live-telemetry-env.js';

vi.mock('../../launch-intent/open-invocation-host.js', () => ({ applyLaunchInvocation: vi.fn() }));

const SENTINEL = 'Authorization=Bearer%20sentinel-strip-k4';

describe('Robota telemetry environment handover', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('removes every Robota telemetry setting from the environment and returns a frozen snapshot', () => {
    const env: NodeJS.ProcessEnv = {
      ROBOTA_TELEMETRY_ENABLED: '1',
      ROBOTA_TELEMETRY_OTLP_HEADERS: SENTINEL,
      ROBOTA_TELEMETRY_SOMETHING_UNKNOWN: 'x',
      ROBOTA_TELEMETRY_UNDEFINED: undefined,
      ROBOTA_OTHER: 'kept',
      PATH: '/usr/bin',
    };
    const snapshot = takeRobotaTelemetryEnvironment(env);
    expect(snapshot).toEqual({
      ROBOTA_TELEMETRY_ENABLED: '1',
      ROBOTA_TELEMETRY_OTLP_HEADERS: SENTINEL,
      ROBOTA_TELEMETRY_SOMETHING_UNKNOWN: 'x',
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(env).toEqual({ ROBOTA_OTHER: 'kept', PATH: '/usr/bin' });
    expect(Object.keys(env).some((key) => key.startsWith('ROBOTA_TELEMETRY_'))).toBe(false);
  });

  it('strips process.env as the first step of CLI startup, even when telemetry is not enabled', async () => {
    const saved = { ...process.env };
    let seenAtLaunch: string[] | undefined;
    vi.mocked(applyLaunchInvocation).mockImplementation(async () => {
      seenAtLaunch = Object.keys(process.env).filter((key) => key.startsWith('ROBOTA_TELEMETRY_'));
      return { kind: 'refused' };
    });
    try {
      delete process.env['ROBOTA_TELEMETRY_ENABLED'];
      process.env['ROBOTA_TELEMETRY_OTLP_HEADERS'] = SENTINEL;
      process.env['ROBOTA_TELEMETRY_OTLP_ENDPOINT'] = 'https://collector.example';
      await startCliCore({ providerDefinitions: [] }, () => []);
      expect(applyLaunchInvocation).toHaveBeenCalledTimes(1);
      expect(seenAtLaunch).toEqual([]);
      expect(process.env['ROBOTA_TELEMETRY_OTLP_HEADERS']).toBeUndefined();
      expect(process.env['ROBOTA_TELEMETRY_OTLP_ENDPOINT']).toBeUndefined();
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });
});
