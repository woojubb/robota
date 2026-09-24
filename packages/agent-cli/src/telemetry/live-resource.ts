import { randomUUID } from 'node:crypto';

export type TLiveTelemetrySurface = 'interactive' | 'print' | 'serve' | 'mcp-serve';

export interface ILiveTelemetryHostResource {
  readonly serviceVersion: string;
  readonly surface: TLiveTelemetrySurface;
}

export interface ILiveTelemetryResource {
  readonly instanceId: string;
  readonly attributes: Readonly<Record<string, string>>;
}

/** Only host-owned fields cross the resource boundary; ambient OTEL_* is never consulted. */
export function createLiveTelemetryResource(host?: ILiveTelemetryHostResource): ILiveTelemetryResource {
  if (host && (!/^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/u.test(host.serviceVersion) ||
    !['interactive', 'print', 'serve', 'mcp-serve'].includes(host.surface))) {
    throw new Error('Invalid Robota telemetry resource identity.');
  }
  const instanceId = randomUUID();
  return {
    instanceId,
    attributes: {
      'service.name': 'robota',
      'service.instance.id': instanceId,
      ...(host ? { 'service.version': host.serviceVersion, 'robota.surface': host.surface } : {}),
    },
  };
}
