import { randomUUID } from 'node:crypto';

export type TLiveTelemetrySurface = 'interactive' | 'print' | 'serve' | 'mcp-serve';

/** The same opaque-ID shape the framework's live-prompt-trace boundary allows through. */
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,128}$/u;

/** A direct host caller must not bypass the framework's opaque-ID allowlist. */
export function safeLiveToolCallId(value: unknown): string | undefined {
  return typeof value === 'string' && OPAQUE_ID.test(value) ? value : undefined;
}

/** Same allowlist as `safeLiveToolCallId`, applied to a provider-returned request ID. */
export function safeLiveProviderRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && OPAQUE_ID.test(value) ? value : undefined;
}

export function resolveLiveTelemetrySurface(
  args: { readonly printMode: boolean; readonly goal: string | undefined; readonly serve: boolean },
  mcpServe: boolean,
): TLiveTelemetrySurface {
  if (args.printMode || args.goal) return 'print';
  if (mcpServe) return 'mcp-serve';
  return args.serve ? 'serve' : 'interactive';
}

export interface ILiveTelemetryHostResource {
  /** Product identity selected by the host; no product name is baked into telemetry code. */
  readonly telemetryServiceName: string;
  readonly serviceVersion: string;
  readonly surface: TLiveTelemetrySurface;
}

export interface ILiveTelemetryResource {
  readonly instanceId: string;
  readonly attributes: Readonly<Record<string, string>>;
}

/** Only host-owned fields cross the resource boundary; ambient OTEL_* is never consulted. */
export function createLiveTelemetryResource(host?: ILiveTelemetryHostResource): ILiveTelemetryResource {
  if (host && (
    !/^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/u.test(host.serviceVersion) ||
    !['interactive', 'print', 'serve', 'mcp-serve'].includes(host.surface) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(host.telemetryServiceName)
  )) {
    throw new Error('Invalid telemetry resource identity.');
  }
  const instanceId = randomUUID();
  return {
    instanceId,
    attributes: {
      ...(host ? { 'service.name': host.telemetryServiceName } : {}),
      'service.instance.id': instanceId,
      ...(host ? { 'service.version': host.serviceVersion, 'agent.surface': host.surface } : {}),
    },
  };
}
