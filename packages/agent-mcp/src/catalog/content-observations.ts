import type { IUniversalObjectValue, TUniversalMessagePart } from '@robota-sdk/agent-core';

type TObservation = { part: TUniversalMessagePart } | { diagnostic: string };
function base64(value: unknown, allowEmpty = false): value is string {
  if (typeof value !== 'string') return false;
  try {
    // Match the SDK's base64 decoding contract, including wrapped and unpadded encodings.
    const decoded = atob(value);
    return allowEmpty || decoded.length > 0;
  } catch {
    return false;
  }
}
function uri(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]*$/u.test(value);
}
function object(value: unknown): value is IUniversalObjectValue {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}
/** Preserve additional observations without resolving references or importing contributor code. */
export function additionalObservation(content: IUniversalObjectValue): TObservation | undefined {
  if (content.type === 'audio') {
    if (
      typeof content.mimeType !== 'string' ||
      !/^audio\/[A-Za-z0-9.+-]+$/u.test(content.mimeType) ||
      !base64(content.data)
    )
      return { diagnostic: 'MCP audio omitted: invalid MIME type or base64 data' };
    return { part: { type: 'audio_inline', mimeType: content.mimeType, data: content.data } };
  }
  if (content.type === 'resource_link') {
    if (!uri(content.uri) || typeof content.name !== 'string' || !content.name.length)
      return { diagnostic: 'MCP resource link omitted: invalid URI or name' };
    for (const key of ['mimeType', 'title', 'description'] as const) {
      if (content[key] !== undefined && typeof content[key] !== 'string')
        return { diagnostic: 'MCP resource link omitted: invalid metadata' };
    }
    if (
      content.size !== undefined &&
      (typeof content.size !== 'number' || !Number.isSafeInteger(content.size) || content.size < 0)
    )
      return { diagnostic: 'MCP resource link omitted: invalid size' };
    return {
      part: {
        type: 'resource_link',
        uri: content.uri,
        name: content.name,
        ...(typeof content.mimeType === 'string' ? { mimeType: content.mimeType } : {}),
        ...(typeof content.title === 'string' ? { title: content.title } : {}),
        ...(typeof content.description === 'string' ? { description: content.description } : {}),
        ...(typeof content.size === 'number' ? { size: content.size } : {}),
      },
    };
  }
  if (content.type === 'resource') {
    const resource = content.resource;
    if (
      !object(resource) ||
      !uri(resource.uri) ||
      (resource.mimeType !== undefined && typeof resource.mimeType !== 'string')
    )
      return { diagnostic: 'MCP embedded resource omitted: invalid URI or metadata' };
    const identity = {
      type: 'resource_embedded' as const,
      uri: resource.uri,
      ...(typeof resource.mimeType === 'string' ? { mimeType: resource.mimeType } : {}),
    };
    if (typeof resource.text === 'string' && resource.blob === undefined)
      return { part: { ...identity, text: resource.text } };
    if (resource.text === undefined && base64(resource.blob, true))
      return { part: { ...identity, blob: resource.blob } };
    return { diagnostic: 'MCP embedded resource omitted: expected text or base64 blob' };
  }
  return undefined;
}
