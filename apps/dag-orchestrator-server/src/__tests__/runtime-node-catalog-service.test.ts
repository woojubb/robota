import { describe, expect, it } from 'vitest';
import type { TObjectInfo } from '@robota-sdk/dag-core';
import { buildDispatchError, buildValidationError } from '@robota-sdk/dag-core';
import type { IPromptApiClientPort } from '@robota-sdk/dag-orchestrator';
import { RuntimeNodeCatalogService } from '../services/runtime-node-catalog-service.js';

const objectInfo: TObjectInfo = {
  KSampler: {
    display_name: 'KSampler',
    category: 'sampling',
    input: { required: {} },
    output: ['IMAGE'],
    output_is_list: [false],
    output_name: ['image'],
    output_node: false,
    description: 'Sampler node',
  },
};

describe('RuntimeNodeCatalogService', () => {
  it('lists object info from the prompt API client', async () => {
    const promptApiClient: Pick<IPromptApiClientPort, 'getObjectInfo'> = {
      async getObjectInfo() {
        return { ok: true, value: objectInfo };
      },
    };
    const service = new RuntimeNodeCatalogService(promptApiClient);

    const result = await service.listObjectInfo();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.KSampler?.category).toBe('sampling');
    }
  });

  it('checks a node type through the prompt API client', async () => {
    const promptApiClient: Pick<IPromptApiClientPort, 'getObjectInfo'> = {
      async getObjectInfo(nodeType?: string) {
        return nodeType === 'KSampler'
          ? { ok: true, value: objectInfo }
          : { ok: false, error: buildValidationError('NODE_TYPE_NOT_FOUND', 'missing') };
      },
    };
    const service = new RuntimeNodeCatalogService(promptApiClient);

    await expect(service.hasNodeType('KSampler')).resolves.toEqual({ ok: true, value: true });
    await expect(service.hasNodeType('Missing')).resolves.toEqual({ ok: true, value: false });
  });

  it('propagates runtime catalog fetch errors', async () => {
    const error = buildDispatchError('NETWORK_ERROR', 'runtime unavailable');
    const promptApiClient: Pick<IPromptApiClientPort, 'getObjectInfo'> = {
      async getObjectInfo() {
        return { ok: false, error };
      },
    };
    const service = new RuntimeNodeCatalogService(promptApiClient);

    await expect(service.hasNodeType('KSampler')).resolves.toEqual({ ok: false, error });
  });
});
