import { describe, expect, it, vi } from 'vitest';
import { createDiscoveredTool } from '../catalog/discovered-tool.js';
import type { IMCPCatalogToolEntry } from '../catalog/types.js';
import type { IMCPToolCallResult } from '../client/session.js';

const entry: IMCPCatalogToolEntry = {
  kind: 'tool',
  canonicalName: 'fixture__observe',
  sourceName: 'observe',
  schema: { type: 'object', properties: {} },
  unenforceablePaths: [],
  disposition: 'adopted',
  provenance: {
    serverId: 'fixture',
    serverName: 'fixture',
    serverVersion: 'pinned',
    protocolVersion: '2025-11-25',
    origin: 'external-fixture',
  },
};
function wav() {
  const bytes = Buffer.alloc(46);
  bytes.write('RIFF');
  bytes.writeUInt32LE(38, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(2, 40);
  return bytes.toString('base64');
}
describe('external resource and audio observations', () => {
  it('retains ordered linked and embedded observations with their opaque source URIs', async () => {
    const callTool = vi.fn(async (): Promise<IMCPToolCallResult> => ({
      isError: false,
      structuredContent: { snapshot: 'opaque-snapshot' },
      content: [
        { type: 'text', text: 'observed' },
        {
          type: 'resource_link',
          uri: 'fixture://state/snapshot-1',
          name: 'snapshot',
          mimeType: 'application/json',
        },
        {
          type: 'resource',
          resource: {
            uri: 'fixture://state/snapshot-1',
            mimeType: 'application/json',
            text: '{"saved":true}',
          },
        },
      ],
    }));
    const result = await createDiscoveredTool(entry, { callTool }).execute(
      {},
      { toolName: entry.canonicalName, parameters: {}, executionId: 'observation-call' },
    );
    expect(result).toMatchObject({
      success: true,
      data: { snapshot: 'opaque-snapshot' },
      parts: [
        { type: 'text', text: 'observed' },
        {
          type: 'resource_link',
          uri: 'fixture://state/snapshot-1',
          name: 'snapshot',
          mimeType: 'application/json',
        },
        {
          type: 'resource_embedded',
          uri: 'fixture://state/snapshot-1',
          mimeType: 'application/json',
          text: '{"saved":true}',
        },
      ],
    });
    expect(callTool).toHaveBeenCalledTimes(1);
  });
  it('retains valid audio alongside structured state instead of dropping the observation', async () => {
    const data = wav();
    const result = await createDiscoveredTool(entry, {
      callTool: async () => ({
        isError: false,
        structuredContent: { recorded: true },
        content: [{ type: 'audio', mimeType: 'audio/wav', data }],
      }),
    }).execute(
      {},
      { toolName: entry.canonicalName, parameters: {}, executionId: 'observation-call' },
    );
    expect(result).toMatchObject({
      success: true,
      data: { recorded: true },
      parts: [{ type: 'audio_inline', mimeType: 'audio/wav', data }],
    });
  });
  it('keeps reconciliation resources on a failed call', async () => {
    const result = await createDiscoveredTool(entry, {
      callTool: async () => ({
        isError: true,
        structuredContent: { effect: 'uncertain' },
        content: [
          { type: 'text', text: 'check persisted state before retrying' },
          {
            type: 'resource',
            resource: { uri: 'fixture://receipt', text: 'actual persisted effect' },
          },
        ],
      }),
    }).execute(
      {},
      { toolName: entry.canonicalName, parameters: {}, executionId: 'observation-call' },
    );
    expect(result).toMatchObject({
      success: false,
      data: { effect: 'uncertain' },
      parts: [
        { type: 'text', text: 'check persisted state before retrying' },
        { type: 'resource_embedded', uri: 'fixture://receipt', text: 'actual persisted effect' },
      ],
    });
  });
});

it.each(['', 'YQ', 'YWI', 'YmluYXJ5', 'YQ==\n', 'Y W\tI=\r\n'])(
  'preserves SDK-compatible binary resource encoding %j',
  async (blob) => {
    const result = await createDiscoveredTool(entry, {
      callTool: async () => ({
        isError: false,
        content: [{ type: 'resource', resource: { uri: 'fixture://binary', blob } }],
      }),
    }).execute({}, { toolName: entry.canonicalName, parameters: {}, executionId: 'binary-call' });
    expect(result).toMatchObject({
      success: true,
      parts: [{ type: 'resource_embedded', uri: 'fixture://binary', blob }],
    });
  },
);
