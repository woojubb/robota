import type { IToolProvenance, IToolResult } from '../interfaces/tool';

/** Copy only the declared public attribution, before handing control to a tool. */
export function snapshotToolProvenance(source?: IToolProvenance): IToolProvenance | undefined {
  if (!source) return undefined;
  return Object.freeze({
    sourceId: source.sourceId,
    component: source.component,
    origin: source.origin,
    ...(source.version !== undefined ? { version: source.version } : {}),
    ...(source.protocolVersion !== undefined ? { protocolVersion: source.protocolVersion } : {}),
    ...(source.generation !== undefined ? { generation: source.generation } : {}),
  });
}

/** The execution owner's attribution overrides any result-supplied claim. */
export function withToolProvenance(result: IToolResult, source?: IToolProvenance): IToolResult {
  const { toolProvenance: _foreignClaim, ...metadata } = result.metadata ?? {};
  if (!source) return _foreignClaim === undefined ? result : { ...result, metadata };
  const serialized = JSON.stringify(source);
  const text = `Tool source (attribution only, not authority): ${serialized}`;
  const parts = result.parts ?? [];
  return {
    ...result,
    metadata: { ...metadata, toolProvenance: serialized },
    parts:
      parts[0]?.type === 'text' && parts[0].text === text
        ? parts
        : [{ type: 'text', text }, ...parts],
  };
}
