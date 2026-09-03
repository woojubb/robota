/**
 * Total decoder for the persisted COMPOSITE instant-node wrapper (issue #2077, ACLI-R1-F015).
 *
 * The inner DAG is decoded by the canonical `dag-core` decoder — this file is a consumer of that
 * codec, not a second DAG schema owner — and the exposed-port wrapper fields are decoded here, field
 * by field, where they used to be cast on a top-level `typeof` check.
 */

import { decodeDagDefinition, type IDagDefinition } from '@robota-sdk/dag-core';

/** Mirrors `IExposedInputPort` / `IExposedOutputPort` in `index.ts` without importing the module graph. */
interface IExposedPortShape {
  readonly key: string;
  readonly mapsTo: { readonly nodeId: string; readonly portKey: string };
  readonly description?: string;
}

export interface IDecodedPersistedComposite {
  readonly innerDag: IDagDefinition;
  readonly exposedInputPort: IExposedPortShape;
  readonly exposedOutputPorts: ReadonlyArray<IExposedPortShape>;
  readonly maxDepth?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function decodeExposedPort(value: unknown): IExposedPortShape | null {
  const record = asRecord(value);
  const mapsTo = record === null ? null : asRecord(record['mapsTo']);
  if (
    record === null ||
    mapsTo === null ||
    typeof record['key'] !== 'string' ||
    typeof mapsTo['nodeId'] !== 'string' ||
    typeof mapsTo['portKey'] !== 'string' ||
    (record['description'] !== undefined && typeof record['description'] !== 'string')
  ) {
    return null;
  }
  const port: { key: string; mapsTo: { nodeId: string; portKey: string }; description?: string } = {
    key: record['key'],
    mapsTo: { nodeId: mapsTo['nodeId'], portKey: mapsTo['portKey'] },
  };
  if (typeof record['description'] === 'string') port.description = record['description'];
  return port;
}

/** `null` when any wrapper field or the inner DAG is malformed. Never throws. */
export function decodePersistedComposite(
  record: Record<string, unknown>,
): IDecodedPersistedComposite | null {
  const innerDag = decodeDagDefinition(record['innerDag']);
  const exposedInputPort = decodeExposedPort(record['exposedInputPort']);
  const rawOutputs = record['exposedOutputPorts'];
  if (
    !innerDag.ok ||
    exposedInputPort === null ||
    !Array.isArray(rawOutputs) ||
    rawOutputs.length === 0
  ) {
    return null;
  }
  const exposedOutputPorts: IExposedPortShape[] = [];
  for (const raw of rawOutputs) {
    const port = decodeExposedPort(raw);
    if (port === null) return null;
    exposedOutputPorts.push(port);
  }
  const maxDepth = record['maxDepth'];
  if (maxDepth !== undefined && (typeof maxDepth !== 'number' || !Number.isFinite(maxDepth))) {
    return null;
  }
  return {
    innerDag: innerDag.value,
    exposedInputPort,
    exposedOutputPorts,
    ...(typeof maxDepth === 'number' ? { maxDepth } : {}),
  };
}
