import type { TUniversalMessagePart } from '../interfaces/messages.js';

/** Text projection for adapters without native resource or audio payload support. Never resolves URIs. */
export function nonVisualObservationText(part: TUniversalMessagePart): string | undefined {
  if (part.type === 'resource_link')
    return `Resource reference (not fetched): ${JSON.stringify(part)}`;
  if (part.type === 'resource_embedded') {
    const identity = `${JSON.stringify(part.uri)}${part.mimeType ? ` (${part.mimeType})` : ''}`;
    if (part.text !== undefined) return `Embedded resource ${identity}:\n${part.text}`;
    return `Embedded binary resource ${identity}; binary content retained but not transmitted by this adapter.`;
  }
  if (part.type === 'audio_inline')
    return `Audio observation (${part.mimeType}); this adapter does not transmit audio payloads.`;
  return undefined;
}
